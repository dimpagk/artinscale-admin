import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Default endpoint (no flags): scoped to contribution-generator +
 * contribution-refiner — preserved for existing topic-inbox callers
 * that rely on this shape.
 *
 * `?grouped=correlation` returns the global feed across ALL agent
 * names, grouped by `correlation_id`. Designed for an operator
 * activity-feed surface that wants to see "Two Birds at Dawn —
 * push pipeline: auto-publisher + mockup-publisher + listing-sync"
 * as a single row instead of 3 unrelated entries.
 *
 * `?limit=N` (default 20, max 200) caps the rowset.
 * `?since=ISO` (default 5min ago) is the lower bound on started_at.
 */
const SUPPORTED_AGENTS = ['contribution-generator', 'contribution-refiner'];
const RECENTLY_DONE_WINDOW_MS = 30_000;

interface AgentTaskRow {
  id: string;
  agent_name: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  correlation_id?: string | null;
}

interface AgentTaskGroup {
  correlationId: string;
  /** e.g. "Two Birds at Dawn" — pulled from the first task's input/output */
  label: string | null;
  startedAt: string;
  tasks: AgentTaskRow[];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const grouped = url.searchParams.get('grouped') === 'correlation';
  const topicId = url.searchParams.get('topic_id');
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 5 * 60 * 1000);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20') || 20, 200);

  let query = supabaseAdmin
    .from('agent_tasks')
    .select(
      'id, agent_name, status, input, output, error_message, started_at, finished_at, correlation_id'
    )
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false })
    .limit(limit);
  if (!grouped) {
    query = query.in('agent_name', SUPPORTED_AGENTS);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as AgentTaskRow[];

  if (grouped) {
    const groups = new Map<string, AgentTaskGroup>();
    const standalone: AgentTaskRow[] = [];

    // Sort newest-first inside each group; oldest-first across groups
    // would be hard to read. Group `startedAt` is the latest start in
    // that group so the operator's feed surfaces the most-recently-
    // active pipeline at the top.
    for (const row of rows) {
      if (!row.correlation_id) {
        standalone.push(row);
        continue;
      }
      const existing = groups.get(row.correlation_id);
      if (existing) {
        existing.tasks.push(row);
        if (row.started_at && row.started_at > existing.startedAt) {
          existing.startedAt = row.started_at;
        }
      } else {
        groups.set(row.correlation_id, {
          correlationId: row.correlation_id,
          label: extractLabel(row),
          startedAt: row.started_at ?? new Date(0).toISOString(),
          tasks: [row],
        });
      }
    }

    // Resolve labels for groups whose first row didn't carry one (e.g.
    // sold-out-notice had a title but auto-publisher didn't). We pull
    // the artwork title once per group when correlation_id matches
    // `artwork:<uuid>`.
    const labelLookups = await Promise.all(
      [...groups.values()]
        .filter((g) => !g.label && g.correlationId.startsWith('artwork:'))
        .map(async (g) => {
          const id = g.correlationId.slice('artwork:'.length);
          const { data: art } = await supabaseAdmin
            .from('artworks')
            .select('title')
            .eq('id', id)
            .maybeSingle();
          return [g.correlationId, (art as { title?: string } | null)?.title ?? null] as const;
        })
    );
    for (const [cid, label] of labelLookups) {
      const g = groups.get(cid);
      if (g) g.label = label;
    }

    const sortedGroups = [...groups.values()].sort((a, b) =>
      a.startedAt < b.startedAt ? 1 : -1
    );
    return NextResponse.json({ groups: sortedGroups, standalone });
  }

  // Legacy (un-grouped) shape — preserved for existing callers.
  const filtered = topicId
    ? rows.filter((r) => (r.input as { topic_id?: string } | null)?.topic_id === topicId)
    : rows;
  const running = filtered.filter((r) => r.status === 'running');
  const recentlyDone = filtered
    .filter((r) => r.status !== 'running' && r.finished_at)
    .filter((r) => Date.now() - new Date(r.finished_at!).getTime() < RECENTLY_DONE_WINDOW_MS);
  return NextResponse.json({ running, recentlyDone });
}

/**
 * Pull a human-readable label from a row when possible. Sold-out-
 * notice carries `output.message`; mockup-publisher carries
 * `output.shopifyHandle`; auto-publisher carries
 * `applied.shopifyHandle`. Falls back to null and a downstream
 * lookup fills it from the artworks table.
 */
function extractLabel(row: AgentTaskRow): string | null {
  const out = row.output ?? {};
  if (typeof out.title === 'string') return out.title;
  if (typeof (out as { applied?: { shopifyHandle?: string } }).applied?.shopifyHandle === 'string') {
    return (out as { applied: { shopifyHandle: string } }).applied.shopifyHandle;
  }
  if (typeof out.shopifyHandle === 'string') return out.shopifyHandle;
  const input = row.input ?? {};
  if (typeof input.title === 'string') return input.title;
  return null;
}
