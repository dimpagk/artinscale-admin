import { NextResponse } from 'next/server';
import { getArtworkById } from '@/lib/artworks';
import { enqueueMockupCompose } from '@/lib/mockup-compose-worker';

export const dynamic = 'force-dynamic';

/**
 * Compose the 5-image mockup set for an artwork:
 *   1 original (kept), 2 focal detail crops, 1 framed close-up, 1 in-room shot.
 *
 * This route only ENQUEUES the work (status='queued' in agent_tasks) and
 * returns immediately; the `mockup_worker` cron claims the task and runs
 * the compose to completion. Compose is too heavy (~100s of Gemini calls)
 * and too important to run fire-and-forget inside a request: a detached
 * promise gets killed when the serverless instance is frozen after the
 * response, which is exactly what left tasks stuck until the reaper failed
 * them. The queue makes it durable. The status pill / pipeline-activity
 * card on the artwork edit page surface progress; on completion the
 * artwork's `mockup_urls` JSONB is updated with the composed set.
 *
 * POST /api/artworks/[id]/compose-mockups
 *   { force?: boolean, aestheticHint?: 'minimal'|'warm'|... }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let force = false;
  let aestheticHint: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    force = body.force === true;
    if (typeof body.aestheticHint === 'string') aestheticHint = body.aestheticHint;
  } catch {
    /* empty body is fine */
  }

  const artwork = await getArtworkById(id);
  if (!artwork) {
    return NextResponse.json({ error: 'Artwork not found' }, { status: 404 });
  }
  if (!artwork.image_url) {
    return NextResponse.json({ error: 'Artwork has no image_url' }, { status: 400 });
  }
  if (!artwork.product_type) {
    return NextResponse.json({ error: 'Artwork has no product_type — set the size first' }, { status: 400 });
  }

  const { taskId, status, deduped } = await enqueueMockupCompose({
    artworkId: id,
    force,
    aestheticHint,
  });

  return NextResponse.json({ task_id: taskId, status, deduped }, { status: 202 });
}

/**
 * GET /api/artworks/[id]/compose-mockups
 *
 * Returns the artwork's current composed set (or null). The mockup
 * gallery card polls this after triggering a compose to pick up the
 * result without a full page reload.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const artwork = await getArtworkById(id);
  if (!artwork) {
    return NextResponse.json({ error: 'Artwork not found' }, { status: 404 });
  }
  return NextResponse.json({ mockup_urls: artwork.mockup_urls ?? null });
}
