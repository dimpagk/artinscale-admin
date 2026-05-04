import { NextResponse } from 'next/server'
import {
  getGeneratedImageById,
  createGeneratedImage,
  stripDerivedMetadata,
} from '@/lib/generated-images'

/**
 * Fork a generated image into a new, independent image.
 *
 * Two modes:
 *   - Fork from current state (default): the new image starts at the
 *     parent's current image_url with a fresh empty edit history
 *   - Fork from a history point: pass `fromEditIndex` and the new image
 *     starts at that history entry's `previousImageUrl`
 *
 * The original is left untouched. The fork has:
 *   - Same prompt, style pack, topic, model
 *   - Same image_url + storage_path (points at the parent's pixels —
 *     they're public + deduped, no need to copy)
 *   - Empty edit_history (the fork starts fresh)
 *   - metadata.forkedFromImageId + metadata.forkedFromEditIndex
 *
 * POST /api/art-generator/{id}/fork
 *   body: { fromEditIndex?: number, label?: string }
 *
 * Returns: { image: GeneratedImage }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { fromEditIndex?: number; label?: string }
  try {
    body = (await request.json().catch(() => ({}))) as typeof body
  } catch {
    body = {}
  }

  const parent = await getGeneratedImageById(id)
  if (!parent) {
    return NextResponse.json({ error: 'Source image not found' }, { status: 404 })
  }

  // Decide which image_url + storage_path the fork starts from
  let sourceImageUrl = parent.image_url
  let sourceStoragePath = parent.storage_path
  let forkPoint = 'current'

  if (typeof body.fromEditIndex === 'number') {
    const entry = parent.edit_history?.[body.fromEditIndex]
    if (!entry) {
      return NextResponse.json(
        { error: `No edit at index ${body.fromEditIndex}` },
        { status: 404 }
      )
    }
    if (!entry.previousImageUrl || !entry.previousStoragePath) {
      return NextResponse.json(
        {
          error:
            'That edit entry was created before per-edit snapshots were tracked. Cannot fork from it.',
        },
        { status: 400 }
      )
    }
    sourceImageUrl = entry.previousImageUrl
    sourceStoragePath = entry.previousStoragePath
    forkPoint = `before edit #${body.fromEditIndex}`
  }

  const inserted = await createGeneratedImage({
    prompt: parent.prompt,
    edit_history: [],
    model: parent.model,
    aspect_ratio: parent.aspect_ratio,
    style_preset: parent.style_preset,
    image_url: sourceImageUrl,
    storage_path: sourceStoragePath,
    topic_id: parent.topic_id,
    artwork_id: null,
    metadata: {
      // Carry forward the meaningful metadata so style similarity, tags,
      // etc. don't have to re-run from scratch — but DROP per-image state
      // (vector data, exemplar mark) since the fork is a fresh start.
      ...stripDerivedMetadata(parent.metadata as Record<string, unknown>),
      forkedFromImageId: parent.id,
      forkedFromEditIndex:
        typeof body.fromEditIndex === 'number' ? body.fromEditIndex : null,
      forkPoint,
      forkLabel: body.label?.trim() || null,
      // Resetting these so the fork has its own decisions to make
      exemplar: false,
      exemplarMarkedAt: null,
      vector: undefined,
    },
  })

  if (!inserted) {
    return NextResponse.json(
      { error: 'Failed to create forked image record' },
      { status: 500 }
    )
  }

  return NextResponse.json({ image: inserted })
}

