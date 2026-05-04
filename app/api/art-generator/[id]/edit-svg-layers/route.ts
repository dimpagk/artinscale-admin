import { NextResponse } from 'next/server'
import {
  applyLayersOrdered,
  appendPrimitive,
  stripEmbeddedImages,
  type Layer,
  type LayerPrimitive,
} from '@/lib/svg-layers'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { getGeneratedImageById, updateGeneratedImage } from '@/lib/generated-images'
import crypto from 'node:crypto'

/**
 * Apply per-layer edits (visibility / recolor) to a vector variant
 * and store the result as a new variant alongside the existing ones.
 *
 * POST /api/art-generator/{id}/edit-svg-layers
 *   body: {
 *     variant_index: number    // which variant in metadata.vector.variants
 *     layers: Layer[]          // operator's edited layer state
 *     name?: string            // optional name for the new variant
 *   }
 *
 * Returns: { vector: VectorMetadata }
 *
 * The new variant gets a derived name like "Risograph Pulse — recolor"
 * unless overridden. Original variants are preserved — every layer
 * edit produces a NEW variant, no destructive overwrites.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: {
    variant_index?: number
    layers?: Layer[]
    name?: string
    /** Optional primitives to append after applying layer edits. */
    primitives?: LayerPrimitive[]
    /** Original-color values to remove entirely from the SVG (hard delete). */
    removedFills?: string[]
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.variant_index !== 'number' || !Array.isArray(body.layers)) {
    return NextResponse.json(
      { error: 'variant_index (number) and layers (array) are required' },
      { status: 400 }
    )
  }

  const image = await getGeneratedImageById(id)
  if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  const meta = image.metadata as Record<string, unknown> | null
  const vector = meta?.vector as
    | {
        masterSvgUrl: string
        masterStoragePath: string
        colorBandCount: number
        variants: Array<{ paletteName: string; paletteHex: string[]; svgUrl: string; svgStoragePath: string }>
        vectorizedAt: string
        isDryRun: boolean
      }
    | undefined

  if (!vector) {
    return NextResponse.json(
      { error: 'Image has not been vectorized yet' },
      { status: 400 }
    )
  }

  const variant = vector.variants[body.variant_index]
  if (!variant) {
    return NextResponse.json(
      { error: `No variant at index ${body.variant_index}` },
      { status: 404 }
    )
  }

  // Pull the source SVG, apply edits, save as a new variant
  const svgRes = await fetch(variant.svgUrl)
  if (!svgRes.ok) {
    return NextResponse.json(
      { error: `Could not fetch source variant SVG: ${svgRes.status}` },
      { status: 502 }
    )
  }
  const sourceSvgRaw = await svgRes.text()
  // Strip any pre-existing <image> elements before applying layers.
  // The client tracks embedded images as primitives (so they're
  // editable), so they'll be re-emitted via appendPrimitive below at
  // their CURRENT positions. Without stripping, we'd double-emit.
  const sourceSvg = stripEmbeddedImages(sourceSvgRaw)
  // Use the ordered variant so the operator's reorder + hard-remove
  // edits are reflected in the persisted SVG, not just the live preview.
  const removedFills = new Set(body.removedFills ?? [])
  let editedSvg = applyLayersOrdered(sourceSvg, body.layers, { removedFills })

  // Append any operator-added primitives (background fill, rect,
  // circle, text, image). Backgrounds insert at the back; everything
  // else paints on top of existing content.
  if (Array.isArray(body.primitives) && body.primitives.length > 0) {
    for (const primitive of body.primitives) {
      const result = appendPrimitive(editedSvg, primitive)
      editedSvg = result.svg
    }
  }

  const baseDir = image.storage_path.replace(/\.png$/, '')
  const stamp = Date.now()
  const newPath = `${baseDir}.${stamp}.layered-${crypto.randomBytes(2).toString('hex')}.svg`
  await uploadFile('ai-generated', newPath, Buffer.from(editedSvg), {
    contentType: 'image/svg+xml',
  })
  const newUrl = getPublicUrl('ai-generated', newPath)

  // Distinct visible-layer colors become the variant's palette signature
  const layerColors = body.layers
    .filter((l) => l.visible)
    .map((l) => l.color)
  const primitiveColors = (body.primitives ?? []).map((p) => p.color)
  const visibleColors = [...layerColors, ...primitiveColors].filter(
    (c, i, arr) => arr.indexOf(c) === i
  )

  const newName =
    body.name?.trim() || `${variant.paletteName} — layer edit`

  const updatedVariants = [
    ...vector.variants,
    {
      paletteName: newName,
      paletteHex: visibleColors,
      svgUrl: newUrl,
      svgStoragePath: newPath,
    },
  ]

  const newMeta = {
    ...vector,
    variants: updatedVariants,
  }

  const updated = await updateGeneratedImage(id, {
    metadata: {
      ...(image.metadata ?? {}),
      vector: newMeta,
    },
  })

  return NextResponse.json({ ok: true, vector: newMeta, image: updated })
}
