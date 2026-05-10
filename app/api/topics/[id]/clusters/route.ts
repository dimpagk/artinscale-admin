import { NextResponse } from 'next/server';
import { clusterTopicContributions } from '@/lib/agents/contribution-clusterer';

/**
 * Cluster a topic's contributions into thematic groups, or return the
 * cached output. The art generator's clustered topic-context picker
 * hits this on topic-select and on operator-driven refresh.
 *
 * GET  /api/topics/{id}/clusters             — returns cached, runs if missing
 * GET  /api/topics/{id}/clusters?refresh=1   — force re-cluster via Gemini
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';

  try {
    const result = await clusterTopicContributions({ topicId: id, force });
    return NextResponse.json({
      ok: true,
      topicId: result.topicId,
      skipped: result.skipped,
      clustering: result.clustering,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
