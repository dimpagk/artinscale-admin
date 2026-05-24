/**
 * Replicate-based image upscaler.
 *
 * Takes a 1024-ish-px Gemini output and produces a 4x upscale (~4096px)
 * suitable for poster prints at 300 DPI. The default model is
 * Real-ESRGAN (`nightmareai/real-esrgan`) — a well-tested, fast,
 * well-priced upscaler that handles AI-generated content cleanly.
 *
 * Required env:
 *   - REPLICATE_API_TOKEN
 *   - UPSCALER_DRY_RUN=true   for local dev without a Replicate account
 *   - REPLICATE_UPSCALER_MODEL_VERSION (optional override)
 *
 * Cost: ~$0.005 per call at 4x. Nothing relative to Gemini's $0.04.
 *
 * Output: a buffer of the upscaled PNG. Caller is responsible for
 * uploading to Storage and updating the relevant row.
 */

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN
const DRY_RUN = process.env.UPSCALER_DRY_RUN === 'true'

/**
 * Replicate's newer "official model" endpoint resolves the latest
 * version automatically — no SHA-pinning required. Falls back to the
 * legacy versioned `/v1/predictions` if `REPLICATE_UPSCALER_MODEL_VERSION`
 * is set explicitly (lets the operator pin a specific SHA if desired).
 */
const MODEL_OWNER = 'nightmareai'
const MODEL_NAME = 'real-esrgan'
const MODEL_VERSION = process.env.REPLICATE_UPSCALER_MODEL_VERSION ?? null

export interface UpscaleArgs {
  imageUrl: string
  /** 2 or 4. Default 4 — biggest gain in print quality. */
  scale?: 2 | 4
  /** Whether to run face enhancement (off by default — we do flat art) */
  faceEnhance?: boolean
}

export interface UpscaleResult {
  buffer: Buffer
  /** Original → upscaled dimension ratio actually applied */
  scale: number
  isDryRun?: boolean
}

export async function upscaleImage(args: UpscaleArgs): Promise<UpscaleResult> {
  if (DRY_RUN) {
    console.log('[Upscaler] DRY RUN — would upscale:', args.imageUrl)
    // Fetch the original and return it as-is — operator can wire real
    // upscaling later, the rest of the pipeline still flows.
    const res = await fetch(args.imageUrl)
    if (!res.ok) {
      throw new Error(`DRY RUN: could not fetch original (${res.status})`)
    }
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      scale: 1,
      isDryRun: true,
    }
  }

  if (!REPLICATE_API_TOKEN) {
    throw new Error(
      'REPLICATE_API_TOKEN missing. Set UPSCALER_DRY_RUN=true to passthrough the original for testing.'
    )
  }

  // Use the model-name endpoint when a version is not pinned — Replicate
  // resolves "latest" server-side. When REPLICATE_UPSCALER_MODEL_VERSION
  // is set, fall back to the SHA-pinned predictions endpoint.
  const url = MODEL_VERSION
    ? 'https://api.replicate.com/v1/predictions'
    : `https://api.replicate.com/v1/models/${MODEL_OWNER}/${MODEL_NAME}/predictions`
  const body = MODEL_VERSION
    ? {
        version: MODEL_VERSION,
        input: {
          image: args.imageUrl,
          scale: args.scale ?? 4,
          face_enhance: args.faceEnhance ?? false,
        },
      }
    : {
        input: {
          image: args.imageUrl,
          scale: args.scale ?? 4,
          face_enhance: args.faceEnhance ?? false,
        },
      }
  const startRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!startRes.ok) {
    throw new Error(`Replicate start error ${startRes.status}: ${await startRes.text()}`)
  }
  const started = (await startRes.json()) as { id: string; urls: { get: string } }

  // Poll for completion (max 90s)
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const pollRes = await fetch(started.urls.get, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    })
    if (!pollRes.ok) {
      throw new Error(`Replicate poll error ${pollRes.status}: ${await pollRes.text()}`)
    }
    const polled = (await pollRes.json()) as {
      status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
      output?: string
      error?: string
    }
    if (polled.status === 'succeeded') {
      if (!polled.output) throw new Error('Replicate succeeded but no output URL')
      const dl = await fetch(polled.output)
      if (!dl.ok) throw new Error(`Failed to download upscaled PNG: ${dl.status}`)
      return {
        buffer: Buffer.from(await dl.arrayBuffer()),
        scale: args.scale ?? 4,
      }
    }
    if (polled.status === 'failed' || polled.status === 'canceled') {
      throw new Error(`Replicate ${polled.status}: ${polled.error ?? 'no detail'}`)
    }
  }
  throw new Error('Replicate upscale timed out after 90s')
}
