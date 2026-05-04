import { NextResponse } from 'next/server'
import { vectorizeImage, recolorSvg } from '@/lib/vectorizer'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { getGeneratedImageById, updateGeneratedImage } from '@/lib/generated-images'
import crypto from 'node:crypto'

/**
 * Vectorize an image and (optionally) generate palette-recolor variants.
 *
 * POST /api/art-generator/{id}/vector-variants
 *   body: { paletteVariants?: string[][] }
 *
 * If `paletteVariants` is omitted, only the master SVG is produced.
 * If supplied, each palette is applied to the master SVG (color-band
 * remapping in `recolorSvg`) and stored as a separate variant.
 *
 * On success, `generated_images.metadata.vector` is updated with:
 *   {
 *     masterSvgUrl,
 *     masterStoragePath,
 *     colorBandCount,
 *     variants: [
 *       { paletteName, paletteHex[], svgUrl, svgStoragePath }
 *     ],
 *     vectorizedAt
 *   }
 *
 * This endpoint replaces the older `/vectorize` route — same engine,
 * cleaner data model that maps directly to "one composition × N
 * colorways = N SKUs."
 */

interface VectorVariant {
  paletteName: string
  paletteHex: string[]
  svgUrl: string
  svgStoragePath: string
}

interface VectorMetadata {
  masterSvgUrl: string
  masterStoragePath: string
  colorBandCount: number
  variants: VectorVariant[]
  vectorizedAt: string
  isDryRun: boolean
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { paletteVariants?: Array<{ name?: string; colors: string[] }> }
  try {
    body = (await request.json().catch(() => ({}))) as {
      paletteVariants?: Array<{ name?: string; colors: string[] }>
    }
  } catch {
    body = {}
  }

  const image = await getGeneratedImageById(id)
  if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  try {
    const result = await vectorizeImage({ imageUrl: image.image_url })
    const baseDir = image.storage_path.replace(/\.png$/, '')
    const stamp = Date.now()
    const masterPath = `${baseDir}.${stamp}.svg`
    await uploadFile('ai-generated', masterPath, Buffer.from(result.svg), {
      contentType: 'image/svg+xml',
    })
    const masterSvgUrl = getPublicUrl('ai-generated', masterPath)

    const variants: VectorVariant[] = []
    const variantInputs = body.paletteVariants ?? []
    let idx = 0
    for (const variant of variantInputs) {
      if (!Array.isArray(variant.colors) || variant.colors.length === 0) {
        continue
      }
      const recolored = recolorSvg(result.svg, variant.colors)
      const variantPath = `${baseDir}.${stamp}.variant-${idx}-${crypto
        .randomBytes(2)
        .toString('hex')}.svg`
      await uploadFile('ai-generated', variantPath, Buffer.from(recolored), {
        contentType: 'image/svg+xml',
      })
      const svgUrl = getPublicUrl('ai-generated', variantPath)
      variants.push({
        paletteName: variant.name?.trim() || `Palette ${idx + 1}`,
        paletteHex: variant.colors,
        svgUrl,
        svgStoragePath: variantPath,
      })
      idx++
    }

    const vectorMetadata: VectorMetadata = {
      masterSvgUrl,
      masterStoragePath: masterPath,
      colorBandCount: result.colorBandCount,
      variants,
      vectorizedAt: new Date().toISOString(),
      isDryRun: result.isDryRun ?? false,
    }

    const updated = await updateGeneratedImage(id, {
      metadata: {
        ...(image.metadata ?? {}),
        vector: vectorMetadata,
      },
    })

    return NextResponse.json({ ok: true, vector: vectorMetadata, image: updated })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
