import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import {
  appendPrimitive,
  type LayerPrimitive,
} from '@/lib/svg-layers'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import {
  getGeneratedImageById,
  updateGeneratedImage,
} from '@/lib/generated-images'
import { ASPECT_RATIOS } from '@/lib/constants/art-generator'

/**
 * Compose a raster image with operator-added primitives into an SVG
 * variant.
 *
 *   Input:
 *     POST /api/art-generator/{id}/compose-raster
 *     body: { primitives: LayerPrimitive[], name?: string }
 *
 *   Output:
 *     { ok: true, image: GeneratedImage }   // image.metadata.vector populated
 *
 * The resulting SVG has the original raster as a full-canvas
 * `<image>` element, with the operator's primitives stacked on top in
 * the order they were authored. We persist that SVG to storage and
 * write a `metadata.vector` entry with this SVG as the master + first
 * (and only) variant. From there, follow-up edits route through the
 * normal `/edit-svg-layers` flow.
 *
 * Notes:
 *   - We don't trace the raster (vtracer) here — colorBandCount is 0.
 *     The user explicitly chose composition-on-raster instead of full
 *     vectorization. They can vectorize later via /vector-variants.
 *   - We don't render to PNG. The SVG itself is the artifact (it
 *     references the raster by URL). promote-variant downstream can
 *     rasterize it for Gelato.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { primitives?: LayerPrimitive[]; name?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const primitives = Array.isArray(body.primitives) ? body.primitives : []
  if (primitives.length === 0) {
    return NextResponse.json(
      { error: 'No primitives supplied — nothing to compose' },
      { status: 400 }
    )
  }

  const image = await getGeneratedImageById(id)
  if (!image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  // Pick the right viewBox dimensions from the image's aspect ratio.
  // Fallback to 1024×1024 for unknown ratios so the SVG is still valid.
  const ratio = ASPECT_RATIOS.find((r) => r.key === image.aspect_ratio)
  const w = ratio?.width ?? 1024
  const h = ratio?.height ?? 1024

  // Synthesize an empty SVG with the right viewBox + namespaces. The
  // operator's primitives already include the source raster as the
  // bottom-of-stack image primitive (auto-injected by ArtStudio on
  // raster-mode init), so this endpoint just stacks primitives in
  // order — no special base-embedding logic.
  let svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `</svg>`,
  ].join('')

  for (const primitive of primitives) {
    const result = appendPrimitive(svg, primitive)
    svg = result.svg
  }

  // Persist the SVG
  const baseDir = image.storage_path.replace(/\.png$/, '')
  const stamp = Date.now()
  const variantPath = `${baseDir}.${stamp}.composed-${crypto
    .randomBytes(2)
    .toString('hex')}.svg`
  await uploadFile('ai-generated', variantPath, Buffer.from(svg), {
    contentType: 'image/svg+xml',
  })
  const variantUrl = getPublicUrl('ai-generated', variantPath)

  // Build the variant + master metadata. Subsequent compose-raster or
  // edit-svg-layers calls extend this list.
  const variantName =
    (body.name && body.name.trim()) || `Composition (${primitives.length} layers)`
  const layerColors = primitives
    .map((p) => p.color)
    .filter((c, i, arr) => arr.indexOf(c) === i)

  const existingVector = (image.metadata as Record<string, unknown> | null)?.vector as
    | {
        masterSvgUrl: string
        masterStoragePath: string
        colorBandCount: number
        variants: Array<{
          paletteName: string
          paletteHex: string[]
          svgUrl: string
          svgStoragePath: string
        }>
        vectorizedAt: string
        isDryRun: boolean
      }
    | undefined

  const newVariant = {
    paletteName: variantName,
    paletteHex: layerColors,
    svgUrl: variantUrl,
    svgStoragePath: variantPath,
  }

  const newVector = existingVector
    ? {
        ...existingVector,
        variants: [...existingVector.variants, newVariant],
      }
    : {
        // First time composing — this SVG becomes the de-facto master.
        masterSvgUrl: variantUrl,
        masterStoragePath: variantPath,
        colorBandCount: 0,
        variants: [newVariant],
        vectorizedAt: new Date().toISOString(),
        isDryRun: false,
      }

  const updated = await updateGeneratedImage(id, {
    metadata: {
      ...((image.metadata as Record<string, unknown> | null) ?? {}),
      vector: newVector,
    },
  })

  if (!updated) {
    return NextResponse.json(
      { error: 'Failed to persist composed variant' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, image: updated })
}
