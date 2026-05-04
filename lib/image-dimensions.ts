/**
 * Image dimension extraction.
 *
 * Server-side helper that fetches a PNG or JPEG and returns its width
 * and height by inspecting the file header — no native deps, no npm
 * dependency on `sharp` / `image-size`.
 *
 * Used by the Gelato push flow to enforce the print-safety guardrail
 * documented in PHASE_0_AUDIT §3.6.
 */

export interface ImageDimensions {
  width: number
  height: number
  format: 'png' | 'jpeg'
}

/**
 * Fetches the first 64 KB of an image (more than enough for the header)
 * and parses its dimensions. Returns null if the format isn't recognized
 * or the response is too small.
 */
export async function fetchImageDimensions(url: string): Promise<ImageDimensions | null> {
  // Try a Range request first (cheaper for large images on a CDN that supports it)
  let bytes: Buffer
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } })
    if (!res.ok && res.status !== 206) {
      return null
    }
    const ab = await res.arrayBuffer()
    bytes = Buffer.from(ab)
  } catch {
    return null
  }

  return parsePng(bytes) ?? parseJpeg(bytes)
}

function parsePng(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47 ||
    buf[4] !== 0x0d ||
    buf[5] !== 0x0a ||
    buf[6] !== 0x1a ||
    buf[7] !== 0x0a
  ) {
    return null
  }
  // IHDR chunk: 4-byte length, 4-byte type "IHDR", then 13-byte data:
  // bytes 16-19 = width, 20-23 = height, big-endian uint32
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width <= 0 || height <= 0) return null
  return { width, height, format: 'png' }
}

function parseJpeg(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length - 8) {
    // Skip pad bytes
    while (i < buf.length && buf[i] !== 0xff) i++
    while (i < buf.length && buf[i] === 0xff) i++
    if (i >= buf.length) return null
    const marker = buf[i]
    i++

    // SOF markers: C0 (baseline), C1, C2, C3, C5-C7, C9-CB, CD-CF
    // Skip: C4 (DHT), C8 (reserved), CC (DAC), DA (SOS), D0-D9 (RST/EOI)
    const isSOF =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc

    if (isSOF) {
      // Segment: 2-byte length, 1-byte precision, 2-byte height, 2-byte width
      if (i + 7 > buf.length) return null
      const height = buf.readUInt16BE(i + 3)
      const width = buf.readUInt16BE(i + 5)
      if (width <= 0 || height <= 0) return null
      return { width, height, format: 'jpeg' }
    }

    // EOI / SOI / RSTn — no length field
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }

    // Other markers carry a 2-byte length
    if (i + 2 > buf.length) return null
    const segLen = buf.readUInt16BE(i)
    i += segLen
  }
  return null
}

/**
 * Validate that an image is print-safe for the requested Gelato product
 * type. Throws a descriptive error if the image is too small or the
 * format is unsupported.
 *
 * If dimensions cannot be determined (URL unreachable, exotic format),
 * logs a warning and lets the push proceed — we'd rather have a soft
 * failure than block on transient network issues.
 */
import { getTemplateConfig } from './gelato-templates'

export async function validatePrintSafety(
  imageUrl: string,
  productType: string
): Promise<void> {
  const config = getTemplateConfig(productType)
  if (!config) {
    // Unknown product type — let downstream Gelato call surface its own error
    return
  }

  const dims = await fetchImageDimensions(imageUrl)
  if (!dims) {
    console.warn(
      `[print-safety] Could not determine dimensions for ${imageUrl} — proceeding without guardrail`
    )
    return
  }

  if (dims.width < config.minImageWidthPx || dims.height < config.minImageHeightPx) {
    const message =
      `Image is too small for "${productType}" — got ${dims.width}×${dims.height}px, ` +
      `need at least ${config.minImageWidthPx}×${config.minImageHeightPx}px (smallest supported size at 150 DPI). ` +
      `Either upscale the image first or push to a smaller product type.`

    // In dry-run mode the chain is being exercised without real prints
    // landing in customers' hands — soften the guardrail to a warning so
    // operators can validate the full pipeline before solving upscaling.
    if (process.env.GELATO_DRY_RUN === 'true') {
      console.warn(`[print-safety] (dry-run, soft warning) ${message}`)
      return
    }

    throw new Error(message)
  }
}
