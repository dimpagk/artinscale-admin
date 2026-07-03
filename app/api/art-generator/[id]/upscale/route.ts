import { NextResponse } from 'next/server'
import { getGeneratedImageById } from '@/lib/generated-images'
import { runUpscaleForGeneratedImage } from '@/lib/upscale-runner'

/**
 * Prepare a generated image's print master.
 *
 * POST /api/art-generator/{id}/upscale
 *   body: { productType?: string }  the target size to prepare for. Omit
 *   to auto-plan the largest size the base can reach (<= 50×70).
 *
 * Delegates to the shared plan-based upscaler (`runUpscaleForGeneratedImage`),
 * the exact logic the auto path uses on push-to-Gelato. It sizes the master
 * to hit 300 DPI at the chosen size (best effort when the base is too small)
 * and picks the method by how far it has to jump:
 *   - factor <= 1.02  → none (already at size)
 *   - factor <= 2     → sharp Lanczos resize (free, no API, no GPU cap)
 *   - factor  > 2     → Clarity (tiles to reach the pixels)
 *
 * This deliberately no longer uses Real-ESRGAN. Gemini now emits ~4K
 * (~17 MP) masters, which exceed Real-ESRGAN's ~2 MP GPU input cap (the
 * "total number of pixels greater than the max size that fits in GPU
 * memory" error) and don't need a blind 4× anyway (4× of 17 MP is ~275 MP
 * for a 50×70 print that only needs ~49 MP).
 *
 * Side effects (handled by the runner):
 *   - Uploads the master to ai-generated://upscaled/<name>-<method>-<hash>.<ext>
 *   - Sets metadata.upscaledImageUrl / upscaledDimensions on the row.
 *
 * The original image_url is preserved — pushToGelatoAction prefers
 * `upscaledImageUrl` when present. Idempotent: re-running returns the
 * existing master.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let productType: string | undefined
  try {
    const body = (await request.json().catch(() => ({}))) as { productType?: string }
    if (typeof body.productType === 'string' && body.productType) productType = body.productType
  } catch {
    /* no body is fine (auto-plan) */
  }

  const image = await getGeneratedImageById(id)
  if (!image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  try {
    const result = await runUpscaleForGeneratedImage({
      generatedImageId: id,
      targetProductType: productType,
    })
    // Return the refreshed row so the client can update its state.
    const updated = await getGeneratedImageById(id)
    return NextResponse.json({
      ok: true,
      upscaledImageUrl: result.upscaledImageUrl,
      dimensions: result.dimensions,
      scale: result.scale,
      productType: result.productType,
      dpi: result.dpi,
      isDryRun: result.isDryRun,
      image: updated,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
