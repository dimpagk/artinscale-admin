import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Returns recent agent_tasks rows that share a correlation_id —
 * typically `artwork:<uuid>` for the auto-publisher chain
 * (auto-publisher, mockup-publisher, listing-sync, sold-out-notice,
 * etc.) triggered from one operator action.
 *
 * Used by the artwork edit page's "Pipeline activity" card to group
 * background tasks under a single timeline instead of scattering them
 * across the global feed.
 *
 * GET /api/agent-tasks/by-correlation?correlation_id=artwork:<uuid>&limit=20
 */
interface AgentTaskRow {
  id: string;
  agent_name: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  correlation_id: string | null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const correlationId = url.searchParams.get('correlation_id');
  if (!correlationId) {
    return NextResponse.json({ error: 'correlation_id is required' }, { status: 400 });
  }
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20') || 20, 100);

  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .select(
      'id, agent_name, status, input, output, error_message, started_at, finished_at, correlation_id'
    )
    .eq('correlation_id', correlationId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as AgentTaskRow[];
  const running = rows.filter((r) => r.status === 'running');
  const completed = rows.filter((r) => r.status !== 'running');

  return NextResponse.json({ correlationId, running, completed, total: rows.length });
}
