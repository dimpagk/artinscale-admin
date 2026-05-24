import { supabaseAdmin } from '@/lib/supabase/admin';

const CONTRIBUTION_AGENTS = ['contribution-generator', 'contribution-refiner'] as const;

export interface ConcurrencyResult {
  ok: boolean;
  running: number;
  limit: number;
  message?: string;
}

/**
 * Count how many contribution-related agent_tasks are currently
 * `running` for a given topic, and refuse to start a new one if the
 * limit is hit. Prevents accidental fire-storms from rapid clicks or
 * multi-tab usage.
 *
 * Default limit: 2 in flight per topic. Generations (which insert
 * rows) and refinements (which mutate them) share the same budget.
 */
export async function checkContributionConcurrency(
  topicId: string,
  limit = 2
): Promise<ConcurrencyResult> {
  const { count, error } = await supabaseAdmin
    .from('agent_tasks')
    .select('id', { count: 'exact', head: true })
    .in('agent_name', CONTRIBUTION_AGENTS as unknown as string[])
    .eq('status', 'running')
    .filter('input->>topic_id', 'eq', topicId);

  if (error) {
    // Don't block on a count failure — log and let it through.
    console.error('checkContributionConcurrency failed:', error.message);
    return { ok: true, running: 0, limit };
  }

  const running = count ?? 0;
  if (running >= limit) {
    return {
      ok: false,
      running,
      limit,
      message: `Too many AI tasks running for this topic (${running}/${limit}). Wait for one to finish before starting another.`,
    };
  }
  return { ok: true, running, limit };
}
