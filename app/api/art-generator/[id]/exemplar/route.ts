import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getGeneratedImageById, updateGeneratedImage } from '@/lib/generated-images'

/**
 * Toggle the exemplar flag on a generated image.
 *
 * POST /api/art-generator/{id}/exemplar
 *   body: { exemplar: boolean }
 *
 * Marking an image as an exemplar means:
 *   - It shows a ★ badge in the gallery
 *   - Future generations from the same style pack use it as a reference
 *     image (replacing or supplementing the static referenceAssetPaths)
 *   - The style similarity check ranks new outputs against approved
 *     exemplars only, not all prior generations
 *
 * The flag is stored in `generated_images.metadata.exemplar` so we
 * don't need a schema change. The fix-up SQL view + filters in
 * `lib/style-packs/exemplars.ts` read it via JSON path.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { exemplar?: boolean }
  try {
    body = (await request.json()) as { exemplar?: boolean }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.exemplar !== 'boolean') {
    return NextResponse.json(
      { error: 'body.exemplar (boolean) is required' },
      { status: 400 }
    )
  }

  const image = await getGeneratedImageById(id)
  if (!image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  const stylePackId = (image.metadata as Record<string, unknown> | null)?.stylePackId
  if (body.exemplar && typeof stylePackId !== 'string') {
    return NextResponse.json(
      {
        error:
          'Cannot mark an image as exemplar — it has no stylePackId in metadata. Generate from a style pack first.',
      },
      { status: 400 }
    )
  }

  const updated = await updateGeneratedImage(id, {
    metadata: {
      ...(image.metadata ?? {}),
      exemplar: body.exemplar,
      exemplarMarkedAt: body.exemplar ? new Date().toISOString() : null,
    },
  })

  // Touch supabaseAdmin to keep the import alive in case future logic
  // wants to bulk-clear or inspect exemplars per style pack.
  void supabaseAdmin

  return NextResponse.json({ ok: true, image: updated })
}
