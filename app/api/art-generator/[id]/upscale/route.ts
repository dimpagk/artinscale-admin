import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { upscaleImage } from '@/lib/upscaler'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { getGeneratedImageById, updateGeneratedImage } from '@/lib/generated-images'
import { fetchImageDimensions } from '@/lib/image-dimensions'

/**
 * Upscale a generated image (typically 1024×1024 from Gemini) to a
 * print-safe resolution (~4096px) via Replicate's Real-ESRGAN.
 *
 * POST /api/art-generator/{id}/upscale
 *   body: { scale?: 2 | 4 }   defaults to 4
 *
 * Side effects:
 *   - Uploads the upscaled PNG to ai-generated://upscaled/<originalName>.png
 *   - Sets `metadata.upscaledImageUrl` and `metadata.upscaledDimensions`
 *
 * The original image_url is preserved — `pushToGelatoAction` will prefer
 * `upscaledImageUrl` when present.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { scale?: 2 | 4 }
  try {
    body = (await request.json().catch(() => ({}))) as { scale?: 2 | 4 }
  } catch {
    body = {}
  }

  const image = await getGeneratedImageById(id)
  if (!image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  try {
    const { buffer, scale, isDryRun } = await upscaleImage({
      imageUrl: image.image_url,
      scale: body.scale ?? 4,
    })

    // Where the original lives → derive a sibling path under upscaled/
    const originalName = image.storage_path.split('/').pop() ?? `${id}.png`
    const baseName = originalName.replace(/\.png$/, '')
    const upscaledPath = `upscaled/${baseName}-x${scale}-${crypto
      .randomBytes(3)
      .toString('hex')}.png`

    await uploadFile('ai-generated', upscaledPath, buffer, {
      contentType: 'image/png',
    })
    const upscaledImageUrl = getPublicUrl('ai-generated', upscaledPath)

    // Read back the dimensions so we have a record (and so the
    // print-safety guardrail will pass on subsequent push).
    const dims = await fetchImageDimensions(upscaledImageUrl)

    const updated = await updateGeneratedImage(id, {
      metadata: {
        ...(image.metadata ?? {}),
        upscaledImageUrl,
        upscaledStoragePath: upscaledPath,
        upscaledScale: scale,
        upscaledDimensions: dims ? { width: dims.width, height: dims.height } : null,
        upscaledAt: new Date().toISOString(),
        upscaledIsDryRun: isDryRun ?? false,
      },
    })

    return NextResponse.json({
      ok: true,
      upscaledImageUrl,
      dimensions: dims,
      scale,
      isDryRun: isDryRun ?? false,
      image: updated,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
