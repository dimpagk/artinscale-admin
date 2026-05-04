import { NextResponse } from 'next/server'
import { getGeneratedImageById, updateGeneratedImage } from '@/lib/generated-images'

/**
 * Restore a generated image to the state immediately BEFORE a given
 * edit history entry — i.e. roll back one or more edits.
 *
 * POST /api/art-generator/{id}/restore-edit
 *   body: { edit_index: number }   // index in edit_history to restore TO (the entry's previousImageUrl becomes new image_url)
 *
 * Behavior:
 *   - Sets `image_url` + `storage_path` to the entry's previous values
 *   - Truncates edit_history to entries BEFORE the restored one
 *   - The restore itself is NOT logged as an edit (it's a rollback,
 *     not a generation)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { edit_index?: number }
  try {
    body = (await request.json()) as { edit_index?: number }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.edit_index !== 'number' || body.edit_index < 0) {
    return NextResponse.json(
      { error: 'edit_index (number) is required' },
      { status: 400 }
    )
  }

  const image = await getGeneratedImageById(id)
  if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  const history = image.edit_history ?? []
  const entry = history[body.edit_index]
  if (!entry) {
    return NextResponse.json(
      { error: `No edit at index ${body.edit_index}` },
      { status: 404 }
    )
  }
  if (!entry.previousImageUrl || !entry.previousStoragePath) {
    return NextResponse.json(
      {
        error:
          'This edit entry was created before per-edit snapshots were tracked. Cannot restore.',
      },
      { status: 400 }
    )
  }

  // Truncate edit_history — keep only entries that came BEFORE the restore point
  const truncated = history.slice(0, body.edit_index)

  const updated = await updateGeneratedImage(id, {
    image_url: entry.previousImageUrl,
    storage_path: entry.previousStoragePath,
    edit_history: truncated,
  })

  return NextResponse.json({ ok: true, image: updated })
}
