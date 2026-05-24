/**
 * Approval queue helpers.
 *
 * Every agent draft lands here. The operator's admin UI reads from here
 * via `listPendingItems`, decisions are written via `decideItem`, and
 * each decision drops a row into `feedback_events` so future agent runs
 * can pull recent decisions as few-shot examples.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'

export type ApprovalItemType =
  | 'topic'
  | 'contribution'
  | 'artwork'
  | 'social_campaign'
  | 'social_post'
  | 'email'
  | 'comment_reply'
  | 'insight'

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'auto_approved'
  | 'expired'

export interface ApprovalQueueRow {
  id: string
  item_type: ApprovalItemType
  payload: Record<string, unknown>
  source_agent: string
  context: Record<string, unknown>
  status: ApprovalStatus
  decided_by: string | null
  decided_at: string | null
  feedback_text: string | null
  edits_diff: Record<string, unknown> | null
  expires_at: string | null
  related_artwork_id: string | null
  related_topic_id: string | null
  created_at: string
  updated_at: string
}

export interface FeedbackEventRow {
  id: string
  queue_item_id: string | null
  item_type: ApprovalItemType
  decision: ApprovalStatus
  reason: string | null
  edits_diff: Record<string, unknown> | null
  source_agent: string | null
  created_at: string
}

export interface EnqueueArgs {
  itemType: ApprovalItemType
  payload: Record<string, unknown>
  sourceAgent: string
  context?: Record<string, unknown>
  expiresAt?: Date | null
  relatedArtworkId?: string | null
  relatedTopicId?: string | null
}

export async function enqueueDraft(args: EnqueueArgs): Promise<ApprovalQueueRow> {
  const { data, error } = await supabaseAdmin
    .from('approval_queue')
    .insert({
      item_type: args.itemType,
      payload: args.payload,
      source_agent: args.sourceAgent,
      context: args.context ?? {},
      expires_at: args.expiresAt?.toISOString() ?? null,
      related_artwork_id: args.relatedArtworkId ?? null,
      related_topic_id: args.relatedTopicId ?? null,
    })
    .select('*')
    .single()

  if (error) throw new Error(`enqueueDraft failed: ${error.message}`)
  return data as ApprovalQueueRow
}

export async function listPendingItems(opts?: {
  itemType?: ApprovalItemType
  limit?: number
}): Promise<ApprovalQueueRow[]> {
  let query = supabaseAdmin
    .from('approval_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(opts?.limit ?? 100)

  if (opts?.itemType) {
    query = query.eq('item_type', opts.itemType)
  }

  const { data, error } = await query
  if (error) throw new Error(`listPendingItems failed: ${error.message}`)
  return (data ?? []) as ApprovalQueueRow[]
}

export async function getQueueItem(id: string): Promise<ApprovalQueueRow | null> {
  const { data, error } = await supabaseAdmin
    .from('approval_queue')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`getQueueItem failed: ${error.message}`)
  return data as ApprovalQueueRow | null
}

export interface DecideArgs {
  decision: 'approved' | 'rejected' | 'edited' | 'auto_approved'
  reason?: string
  editsDiff?: Record<string, unknown>
  decidedBy?: string
}

export async function decideItem(id: string, args: DecideArgs): Promise<void> {
  const item = await getQueueItem(id)
  if (!item) throw new Error(`Queue item ${id} not found`)
  if (item.status !== 'pending') {
    throw new Error(`Queue item ${id} already decided (status=${item.status})`)
  }

  const { error: updateError } = await supabaseAdmin
    .from('approval_queue')
    .update({
      status: args.decision,
      decided_by: args.decidedBy ?? null,
      decided_at: new Date().toISOString(),
      feedback_text: args.reason ?? null,
      edits_diff: args.editsDiff ?? null,
    })
    .eq('id', id)

  if (updateError) throw new Error(`decideItem update failed: ${updateError.message}`)

  const { error: feedbackError } = await supabaseAdmin
    .from('feedback_events')
    .insert({
      queue_item_id: id,
      item_type: item.item_type,
      decision: args.decision,
      reason: args.reason ?? null,
      edits_diff: args.editsDiff ?? null,
      source_agent: item.source_agent,
    })

  if (feedbackError) {
    console.error('decideItem: feedback log failed (non-fatal):', feedbackError)
  }
}

/**
 * Recent decisions for an item type, used by agents to construct few-shot
 * examples in their prompts.
 */
export async function recentFeedback(
  itemType: ApprovalItemType,
  limit = 20
): Promise<FeedbackEventRow[]> {
  const { data, error } = await supabaseAdmin
    .from('feedback_events')
    .select('*')
    .eq('item_type', itemType)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`recentFeedback failed: ${error.message}`)
  return (data ?? []) as FeedbackEventRow[]
}

export async function pendingCountByType(): Promise<Record<ApprovalItemType, number>> {
  const { data, error } = await supabaseAdmin
    .from('approval_queue')
    .select('item_type')
    .eq('status', 'pending')

  if (error) throw new Error(`pendingCountByType failed: ${error.message}`)

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const type = (row as { item_type: string }).item_type
    counts[type] = (counts[type] ?? 0) + 1
  }
  return counts as Record<ApprovalItemType, number>
}
