/**
 * Topic status updater — the cron-driven half of the topic lifecycle
 * state machine. The other half lives in `applyListedState` (event-
 * driven, fires when an artwork is marked listed and flips its linked
 * topic `in_production → completed`).
 *
 * Lifecycle:
 *   upcoming       (operator-set, pre-launch)
 *   active         (collecting contributions)
 *      └─ this cron flips to `in_production` when deadline passes
 *   in_production  (deadline passed, artwork being made)
 *      └─ event-driven flip to `completed` when first linked artwork is listed
 *   completed      (artwork live and available)
 *
 * Idempotent: runs every 6h via cron and is a no-op when nothing
 * needs flipping. Safe to run as often as desired — uses a single SQL
 * UPDATE filtered by status + deadline so duplicate concurrent runs
 * don't double-flip.
 *
 * Why not date-derived in the UI: the storefront's topic lifecycle is
 * a state machine, not a function of `now()`. Keeping status as the
 * authoritative field means UI components stay simple and the same
 * topic state renders identically across surfaces (teaser cards,
 * detail page, admin inbox, agent prompts).
 */

import { supabaseAdmin } from './supabase/admin';

export interface TopicStatusUpdateResult {
  ranAt: string;
  expired: { id: string; title: string; deadline: string }[];
  errors: string[];
}

export async function runTopicStatusUpdater(): Promise<TopicStatusUpdateResult> {
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  // Find every topic that should flip active → in_production.
  // We do the SELECT-then-UPDATE pattern (rather than a one-shot
  // UPDATE ... RETURNING) so we can log which topics were flipped.
  const { data: due, error: selErr } = await supabaseAdmin
    .from('topics')
    .select('id, title, deadline')
    .eq('status', 'active')
    .not('deadline', 'is', null)
    .lt('deadline', nowIso);

  if (selErr) {
    errors.push(`select active+expired: ${selErr.message}`);
    return { ranAt: nowIso, expired: [], errors };
  }

  const expired: TopicStatusUpdateResult['expired'] = [];
  for (const topic of due ?? []) {
    const { error: upErr } = await supabaseAdmin
      .from('topics')
      .update({ status: 'in_production' })
      .eq('id', topic.id)
      .eq('status', 'active'); // optimistic-lock guard against concurrent runs
    if (upErr) {
      errors.push(`update ${topic.id}: ${upErr.message}`);
      continue;
    }
    expired.push({
      id: topic.id,
      title: topic.title,
      deadline: topic.deadline,
    });
  }

  return { ranAt: nowIso, expired, errors };
}
