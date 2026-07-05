/**
 * Approval-inbox execution bridge.
 *
 * Recording a decision in `approval_queue` (via `decideItem`) is intent.
 * The executor here is the second half: when an item is approved or
 * edited, it materializes the downstream effect — creating social_posts
 * from a campaign draft, sending an approved email, posting a reply to
 * Meta, inserting a topic row, etc.
 *
 * Design choices:
 *   - Executors run AFTER `decideItem`, never inside it. The decision +
 *     feedback log is the source of truth even if execution later fails.
 *   - Each executor returns { executed, details? } or throws. The caller
 *     surfaces failures in the UI and can offer a retry button.
 *   - Executors are idempotent where possible (e.g. social_campaign
 *     re-execution is a no-op once social_posts already exist for the
 *     campaign's queue item).
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/resend'
import { publishSocialPost } from '@/lib/publishers/meta-graph'
import type { ApprovalQueueRow } from '@/lib/queue'

export interface ExecutorResult {
  executed: boolean
  details?: Record<string, unknown>
  skippedReason?: string
}

export async function executeApprovedItem(
  item: ApprovalQueueRow
): Promise<ExecutorResult> {
  switch (item.item_type) {
    case 'social_campaign':
      return executeSocialCampaign(item)
    case 'social_post':
      return executeSocialPost(item)
    case 'email':
      return executeEmail(item)
    case 'comment_reply':
      return executeCommentReply(item)
    case 'topic':
      return executeTopic(item)
    case 'contribution':
      return executeContributionBatch(item)
    case 'insight':
      // Insights are read-only — no downstream materialization
      return { executed: false, skippedReason: 'insight is read-only' }
    case 'artwork':
      // Artwork drafts route through the existing artwork CRUD flow
      return { executed: false, skippedReason: 'artwork drafts are not yet materialized by the executor' }
    default:
      return { executed: false, skippedReason: `no executor for item_type=${item.item_type}` }
  }
}

// ============================================
// social_campaign
//
// Materialize the 5-post campaign as 5 `social_posts` rows. Each post
// keeps its `kind`, `caption`, and visual_brief. They start in status
// 'draft' awaiting the operator's Content Studio export + schedule.
// ============================================

async function executeSocialCampaign(item: ApprovalQueueRow): Promise<ExecutorResult> {
  const payload = item.payload as {
    artwork_id?: string
    artwork_title?: string
    artist_name?: string
    posts?: Array<{
      kind: string
      caption: string
      hashtags?: string[]
      call_to_action?: string
      visual_brief?: string
      ai_disclosure?: string
    }>
  }

  if (!Array.isArray(payload.posts) || payload.posts.length === 0) {
    throw new Error('social_campaign payload has no posts')
  }

  // Idempotency: skip if we have already materialized this campaign
  const { data: existing } = await supabaseAdmin
    .from('social_posts')
    .select('id')
    .eq('artwork_id', payload.artwork_id ?? null)
    .contains('tags', [`campaign:${item.id}`])
    .limit(1)

  if ((existing ?? []).length > 0) {
    return { executed: false, skippedReason: 'campaign already materialized' }
  }

  const inserts = payload.posts.map((post) => ({
    title: `${payload.artwork_title ?? 'Drop'} — ${post.kind}`,
    platform: 'instagram', // default; the schedule action picks platforms when posting
    post_type: 'single',
    visual_config: {
      kind: post.kind,
      visual_brief: post.visual_brief ?? '',
      ai_disclosure: post.ai_disclosure ?? '',
      hashtags: post.hashtags ?? [],
      call_to_action: post.call_to_action ?? '',
      blocks: [],
    },
    caption: assembleCaption(post),
    status: 'draft',
    artwork_id: payload.artwork_id ?? null,
    tags: [`campaign:${item.id}`, `kind:${post.kind}`],
  }))

  const { data: rows, error } = await supabaseAdmin
    .from('social_posts')
    .insert(inserts)
    .select('id, title')

  if (error) throw new Error(`social_posts insert failed: ${error.message}`)

  return {
    executed: true,
    details: {
      createdSocialPostIds: (rows ?? []).map((r) => (r as { id: string }).id),
      count: rows?.length ?? 0,
    },
  }
}

function assembleCaption(post: {
  caption: string
  hashtags?: string[]
  call_to_action?: string
  ai_disclosure?: string
}): string {
  const parts = [post.caption.trim()]
  if (post.call_to_action) parts.push(`\n\n${post.call_to_action.trim()}`)
  // Brand rule (operator, 2026-07): no AI-provenance wording in
  // customer-facing copy, so ai_disclosure is no longer appended to the
  // caption. The Meta paid-ads AI disclosure is a form toggle, not text.
  if (post.hashtags?.length) parts.push(`\n\n${post.hashtags.join(' ')}`)
  return parts.join('').trim()
}

// ============================================
// social_post (single)
//
// For a generic single social_post draft (not produced by a campaign),
// just mark the underlying social_posts row as approved. Scheduling is
// done separately via `schedulePostForPublishingAction`.
// ============================================

async function executeSocialPost(item: ApprovalQueueRow): Promise<ExecutorResult> {
  const payload = item.payload as { social_post_id?: string }
  if (!payload.social_post_id) {
    return { executed: false, skippedReason: 'no social_post_id on payload' }
  }
  const { error } = await supabaseAdmin
    .from('social_posts')
    .update({ status: 'draft' })
    .eq('id', payload.social_post_id)
  if (error) throw new Error(`social_post update failed: ${error.message}`)
  return { executed: true, details: { socialPostId: payload.social_post_id } }
}

// ============================================
// email
//
// Send the approved email via Resend.
// ============================================

async function executeEmail(item: ApprovalQueueRow): Promise<ExecutorResult> {
  const payload = item.payload as {
    to?: string | string[]
    subject?: string
    html?: string
    text?: string
    kind?: string
  }

  if (!payload.to || !payload.subject || !payload.html) {
    throw new Error('email payload missing one of: to, subject, html')
  }

  const result = await sendEmail({
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    tags: [
      { name: 'queue_item', value: item.id },
      { name: 'agent', value: item.source_agent },
      ...(payload.kind ? [{ name: 'kind', value: payload.kind }] : []),
    ],
  })

  return { executed: true, details: { sendId: result.id, isDryRun: result.isDryRun ?? false } }
}

// ============================================
// comment_reply
//
// Post the reply directly to Meta + close the thread.
// ============================================

async function executeCommentReply(item: ApprovalQueueRow): Promise<ExecutorResult> {
  const payload = item.payload as {
    thread_id?: string
    reply_text?: string
    flag_for_human?: boolean
    flag_reason?: string
  }

  if (!payload.thread_id || !payload.reply_text) {
    throw new Error('comment_reply payload missing thread_id or reply_text')
  }

  if (payload.flag_for_human) {
    return {
      executed: false,
      skippedReason: `flagged for human handling: ${payload.flag_reason ?? '(no reason)'}`,
    }
  }

  // Look up the comment thread for platform + external_thread_id
  const { data: thread } = await supabaseAdmin
    .from('comment_threads')
    .select('platform, external_thread_id, status, related_post_id')
    .eq('id', payload.thread_id)
    .maybeSingle()

  if (!thread) throw new Error(`comment_thread ${payload.thread_id} not found`)
  const t = thread as {
    platform: 'instagram' | 'facebook'
    external_thread_id: string
    status: string
    related_post_id: string | null
  }

  if (t.status !== 'open') {
    return { executed: false, skippedReason: `thread status is ${t.status}` }
  }

  // Direct Meta Graph reply: POST /{comment-id}/replies
  // Currently the publisher exposes top-level publishing only; for comment
  // replies we call the Graph API inline with a minimal payload. Wraps the
  // shared error handling into a local fetch.
  const accessToken = process.env.META_GRAPH_ACCESS_TOKEN
  if (!accessToken) {
    throw new Error('META_GRAPH_ACCESS_TOKEN required to post comment replies')
  }
  const apiVersion = process.env.META_GRAPH_API_VERSION ?? 'v18.0'
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(t.external_thread_id)}/replies`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: payload.reply_text, access_token: accessToken }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Meta Graph reply error ${res.status}: ${body}`)
  }
  const data = (await res.json()) as { id?: string }

  await supabaseAdmin
    .from('comment_threads')
    .update({ status: 'replied' })
    .eq('id', payload.thread_id)

  return { executed: true, details: { replyId: data.id, platform: t.platform } }
}

// Reference unused import only for clarity; published post helper lives in publisher
void publishSocialPost

// ============================================
// topic
//
// Insert into the storefront's `topics` table.
// ============================================

async function executeTopic(item: ApprovalQueueRow): Promise<ExecutorResult> {
  const payload = item.payload as {
    slug_suggestion?: string
    title?: string
    short_description?: string
    long_description?: string
    contribution_types?: Array<'story' | 'photo' | 'sound' | 'link'>
    prompts?: string[]
  }

  if (!payload.slug_suggestion || !payload.title || !payload.short_description) {
    throw new Error('topic payload missing slug_suggestion / title / short_description')
  }

  // Idempotency: skip if a topic with this id already exists
  const { data: existing } = await supabaseAdmin
    .from('topics')
    .select('id')
    .eq('id', payload.slug_suggestion)
    .maybeSingle()

  if (existing) {
    return { executed: false, skippedReason: `topic ${payload.slug_suggestion} already exists` }
  }

  const contributionTypes = (payload.contribution_types ?? ['story', 'photo']).map((t) => ({
    type: t,
    title: t.charAt(0).toUpperCase() + t.slice(1),
    description: `${t} contributions for this topic`,
    examples: [],
  }))

  const { error } = await supabaseAdmin.from('topics').insert({
    id: payload.slug_suggestion,
    title: payload.title,
    description: payload.short_description,
    long_description: payload.long_description ?? payload.short_description,
    status: 'upcoming',
    contribution_types: contributionTypes,
    prompts: payload.prompts ?? [],
  })

  if (error) throw new Error(`topic insert failed: ${error.message}`)
  return { executed: true, details: { topicId: payload.slug_suggestion } }
}

// ============================================
// contribution batch
//
// Apply the agent's recommendations to topic_contributions.status.
// ============================================

async function executeContributionBatch(item: ApprovalQueueRow): Promise<ExecutorResult> {
  const payload = item.payload as {
    decisions?: Array<{
      contribution_id?: string
      recommendation?: 'approve' | 'reject' | 'flag_for_review'
    }>
  }

  if (!Array.isArray(payload.decisions) || payload.decisions.length === 0) {
    return { executed: false, skippedReason: 'no decisions on payload' }
  }

  let applied = 0
  let flagged = 0
  for (const d of payload.decisions) {
    if (!d.contribution_id || !d.recommendation) continue
    if (d.recommendation === 'flag_for_review') {
      flagged += 1
      continue
    }
    const newStatus = d.recommendation === 'approve' ? 'approved' : 'rejected'
    const { error } = await supabaseAdmin
      .from('topic_contributions')
      .update({ status: newStatus })
      .eq('id', d.contribution_id)
      .eq('status', 'pending')
    if (error) {
      console.error(`contribution ${d.contribution_id} update failed: ${error.message}`)
      continue
    }
    applied += 1
  }

  return {
    executed: applied > 0,
    details: { applied, flagged, total: payload.decisions.length },
    ...(applied === 0 ? { skippedReason: 'no decisions applied — all were flagged or invalid' } : {}),
  }
}
