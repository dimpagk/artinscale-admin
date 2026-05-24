import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface AgentTaskInput {
  topic_id?: string;
  instructions?: string;
  ids?: string[] | null;
}

interface AgentTaskRow {
  id: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  input: AgentTaskInput | null;
  output: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: contribution, error: cErr } = await supabaseAdmin
    .from('topic_contributions')
    .select('topic_id, previous_versions')
    .eq('id', id)
    .single();

  if (cErr || !contribution) {
    return NextResponse.json({ error: 'Contribution not found' }, { status: 404 });
  }

  const versions = Array.isArray(contribution.previous_versions)
    ? (contribution.previous_versions as Array<{ refine_task_id?: string | null }>)
    : [];
  const versionTaskIds = new Set(
    versions
      .map((v) => (typeof v?.refine_task_id === 'string' ? v.refine_task_id : null))
      .filter((v): v is string => v !== null)
  );

  const { data: tasks, error: tErr } = await supabaseAdmin
    .from('agent_tasks')
    .select('id, status, input, output, error_message, started_at, finished_at')
    .eq('agent_name', 'contribution-refiner')
    .order('started_at', { ascending: false })
    .limit(50);

  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  const relevant = (tasks ?? [])
    .map((t) => t as AgentTaskRow)
    .filter((t) => t.input?.topic_id === contribution.topic_id)
    .filter((t) => {
      const ids = t.input?.ids;
      // Specific refine that targeted this contribution
      if (Array.isArray(ids) && ids.length > 0) return ids.includes(id);
      // Bulk refine — only relevant if it actually wrote a version to this row
      return versionTaskIds.has(t.id);
    })
    .map((t) => ({
      id: t.id,
      status: t.status,
      instructions: t.input?.instructions ?? null,
      scope: Array.isArray(t.input?.ids) && t.input?.ids?.length
        ? (t.input.ids.includes(id) ? 'targeted' : 'unrelated')
        : 'all_pending_seeds',
      started_at: t.started_at,
      finished_at: t.finished_at,
      error: t.error_message,
    }))
    .filter((t) => t.scope !== 'unrelated');

  return NextResponse.json({ history: relevant });
}
