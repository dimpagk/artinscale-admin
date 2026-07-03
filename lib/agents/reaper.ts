import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Stale-task reaper.
 *
 * Background agent tasks run fire-and-forget inside the Next.js server
 * process (see `startAgentTask` in ./base.ts and the compose-mockups
 * route). If that process is restarted or crashes mid-run, the
 * agent_tasks row is orphaned at status='running' forever —
 * `finishAgentTask` never fires — and the artwork edit page's
 * pipeline-activity card shows a perpetual "In progress" that only a
 * manual PATCH to 'failed' clears.
 *
 * This sweep marks any row still 'running' past a max-runtime threshold
 * as 'failed', so orphans self-heal. It is idempotent and guarded: it
 * only ever touches rows that are still 'running' AND started before the
 * cutoff, and after the update they are terminal, so a second sweep is a
 * no-op. Uses `supabaseAdmin` (service role) so it bypasses RLS the same
 * way the rest of the task lifecycle does.
 *
 * A healthy mockup-composer run finishes in ~100s and the Gemini call
 * ceiling is ~60s, so 5 minutes is comfortably past any real run. This
 * pairs with the per-call timeout in mockup-composer.ts: the timeout
 * fails a run cleanly when the process survives; the reaper covers the
 * case where the process itself dies before `finishAgentTask` can run.
 */

export const STALE_TASK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

const REAP_MESSAGE =
  'Auto-reaped: task exceeded max runtime, worker likely restarted mid-run';

// Best-effort in-process throttle so a burst of pipeline-activity polls
// (each open artwork page polls every 3s while a task runs) doesn't fire
// a sweep on every request. `lastSweepAt` starts at 0 so the first call
// after a cold start / page open always runs, healing orphans
// immediately; subsequent polls within the window are cheap no-ops.
// Serverless instances each keep their own clock — that's fine, the
// sweep is global and idempotent.
const MIN_SWEEP_INTERVAL_MS = 30 * 1000;
let lastSweepAt = 0;

/**
 * Mark orphaned `running` agent_tasks (started before the threshold) as
 * `failed`. Never throws — a hiccup here must not break the poll
 * endpoint that reads live task state right after.
 *
 * @param options.thresholdMs  Max runtime before a row is considered
 *   stale. Defaults to {@link STALE_TASK_THRESHOLD_MS}.
 * @param options.force  Skip the in-process throttle (e.g. a scheduled
 *   sweep that wants to run every time it's invoked).
 * @returns The number of rows reaped this sweep (0 when throttled or on
 *   error).
 */
export async function reapStaleAgentTasks(options?: {
  thresholdMs?: number;
  force?: boolean;
}): Promise<{ reaped: number }> {
  const now = Date.now();
  if (!options?.force && now - lastSweepAt < MIN_SWEEP_INTERVAL_MS) {
    return { reaped: 0 };
  }
  lastSweepAt = now;

  const thresholdMs = options?.thresholdMs ?? STALE_TASK_THRESHOLD_MS;
  const cutoff = new Date(now - thresholdMs).toISOString();

  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .update({
      status: 'failed',
      error_message: REAP_MESSAGE,
      finished_at: new Date(now).toISOString(),
    })
    // Guard: only ever touch rows that are still running and older than
    // the cutoff. `.lt` excludes NULL started_at, so a row that never
    // recorded a start is left alone rather than reaped on a guess.
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id');

  if (error) {
    // Non-fatal, matching finishAgentTask — the poll endpoint should
    // still return live data even if the sweep hiccups.
    console.error(`reapStaleAgentTasks failed (non-fatal): ${error.message}`);
    return { reaped: 0 };
  }

  const reaped = data?.length ?? 0;
  if (reaped > 0) {
    console.warn(
      `reapStaleAgentTasks: marked ${reaped} stale task(s) as failed (older than ${Math.round(
        thresholdMs / 1000
      )}s)`
    );
  }
  return { reaped };
}
