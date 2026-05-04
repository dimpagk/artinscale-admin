import { NextResponse } from 'next/server'
import { getGeneratedImageById, updateGeneratedImage } from '@/lib/generated-images'
import { vectorizeImage, recolorSvg } from '@/lib/vectorizer'
import { getStylePack } from '@/lib/style-packs'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import crypto from 'node:crypto'

/**
 * Vectorize a generated image and (optionally) produce palette variants.
 *
 * POST /api/art-generator/vectorize
 *   body: {
 *     imageId: string,            // generated_images.id
 *     paletteVariants?: string[][] // optional list of palettes (each an array of hex codes)
 *   }
 *
 * Output:
 *   - Stores the SVG at `ai-generated/<storage_path>.svg`
 *   - Updates `generated_images.metadata.vector` with the SVG URL +
 *     color band count
 *   - For each requested palette variant, stores a recolored SVG and
 *     adds it to `metadata.vector.variants`
 */

export async function POST(request: Request) {
  let body: { imageId?: string; paletteVariants?: string[][] }
  try {
    body = (await request.json()) as { imageId?: string; paletteVariants?: string[][] }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.imageId) {
    return NextResponse.json({ error: 'imageId required' }, { status: 400 })
  }

  const image = await getGeneratedImageById(body.imageId)
  if (!image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  try {
    const result = await vectorizeImage({ imageUrl: image.image_url })

    const baseDir = image.storage_path.replace(/\.png$/, '')
    const masterSvgPath = `${baseDir}.svg`
    await uploadFile('ai-generated', masterSvgPath, Buffer.from(result.svg), {
      contentType: 'image/svg+xml',
    })
    const masterSvgUrl = getPublicUrl('ai-generated', masterSvgPath)

    const variants: Array<{ paletteName: string; url: string; storagePath: string; palette: string[] }> = []

    // If the artwork has an inferred style pack, automatically include its
    // locked palette as one variant for completeness.
    const stylePackId = (image.metadata as Record<string, unknown> | null)?.stylePackId as string | undefined
    const stylePack = stylePackId ? getStylePack(stylePackId) : null
    const palettesToTry: string[][] = []
    if (stylePack) palettesToTry.push(stylePack.palette.colors)
    if (Array.isArray(body.paletteVariants)) {
      for (const p of body.paletteVariants) {
        if (Array.isArray(p) && p.every((c) => typeof c === 'string')) {
          palettesToTry.push(p)
        }
      }
    }

    let variantIndex = 0
    for (const palette of palettesToTry) {
      const recolored = recolorSvg(result.svg, palette)
      const variantPath = `${baseDir}.variant-${variantIndex}.svg`
      await uploadFile('ai-generated', variantPath, Buffer.from(recolored), {
        contentType: 'image/svg+xml',
      })
      const variantUrl = getPublicUrl('ai-generated', variantPath)
      variants.push({
        paletteName: variantIndex === 0 && stylePack ? stylePack.persona.name : `palette-${variantIndex}`,
        url: variantUrl,
        storagePath: variantPath,
        palette,
      })
      variantIndex += 1
    }

    const existingMetadata = (image.metadata ?? {}) as Record<string, unknown>
    const updated = await updateGeneratedImage(body.imageId, {
      metadata: {
        ...existingMetadata,
        vector: {
          masterSvgUrl,
          masterStoragePath: masterSvgPath,
          colorBandCount: result.colorBandCount,
          isDryRun: result.isDryRun ?? false,
          variants,
          vectorizedAt: new Date().toISOString(),
        },
      },
    })

    return NextResponse.json({
      ok: true,
      masterSvgUrl,
      colorBandCount: result.colorBandCount,
      variants,
      isDryRun: result.isDryRun ?? false,
      image: updated,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

// Dummy reference so TS doesn't trim the unused import in some configs
void crypto
