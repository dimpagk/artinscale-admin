/**
 * Contribution moderator.
 *
 * Trigger: cron OR new pending contribution event.
 * Output:  one approval_queue row with item_type='contribution' per
 *          batch of pending contributions, summarizing the agent's
 *          recommendation (approve / reject / flag) for each.
 *
 * Idempotent: skips contributions that have already been classified
 * in a recent batch.
 */

import { callClaude, extractJson, startAgentTask, finishAgentTask } from './base'
import { enqueueDraft } from '@/lib/queue'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type ContributionRecommendation =
  | 'approve'
  | 'reject'
  | 'flag_for_review'

export interface ContributionDecision {
  contribution_id: string
  contributor_name: string
  type: 'story' | 'photo' | 'sound' | 'link'
  preview: string
  recommendation: ContributionRecommendation
  reasoning: string
  brand_safety_concerns: string[]
}

export interface ContributionBatch {
  topic_id: string
  topic_title: string
  decisions: ContributionDecision[]
}

const SYSTEM_PROMPT = `You are moderating community contributions submitted to ArtInScale, a topic-driven art platform.

For each contribution, classify it as:
  - "approve": clearly relevant, safe, and would meaningfully inspire artwork
  - "reject": spam, irrelevant, harmful, or low-effort
  - "flag_for_review": ambiguous — requires human judgment

Brand safety concerns to call out:
  - Hate speech, harassment, sexual content involving minors, illegal activity
  - PII leaks (real phone numbers, addresses, etc.)
  - Off-topic political or commercial messaging

Output JSON:
{
  "decisions": [
    {
      "contribution_id": "...uuid...",
      "contributor_name": "...",
      "type": "story" | "photo" | "sound" | "link",
      "preview": "...first 100 chars of content...",
      "recommendation": "approve" | "reject" | "flag_for_review",
      "reasoning": "...one sentence...",
      "brand_safety_concerns": ["...zero or more flags..."]
    },
    ...
  ]
}`

export async function runContributionModerator(args?: {
  topicId?: string
  triggerKind?: 'cron' | 'event' | 'manual'
}): Promise<{ approvalQueueId: string } | { skipped: 'already_running' | 'no_pending' }> {
  const today = new Date().toISOString().slice(0, 10)
  const triggerKey = args?.topicId ? `${args.topicId}-${today}` : `daily-${today}`

  const task = await startAgentTask({
    agentName: 'contribution_moderator',
    triggerKind: args?.triggerKind ?? 'cron',
    triggerKey,
    input: { topicId: args?.topicId ?? null },
  })

  if (!task) return { skipped: 'already_running' }

  try {
    let query = supabaseAdmin
      .from('topic_contributions')
      .select('id, topic_id, type, contributor_name, content, caption, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50)

    if (args?.topicId) query = query.eq('topic_id', args.topicId)

    const { data: pending } = await query
    const items = (pending ?? []) as Array<{
      id: string
      topic_id: string
      type: 'story' | 'photo' | 'sound' | 'link'
      contributor_name: string
      content: string
      caption: string | null
      created_at: string
    }>

    if (items.length === 0) {
      await finishAgentTask(task.id, { status: 'succeeded', output: { reason: 'no_pending' } })
      return { skipped: 'no_pending' }
    }

    // Group by topic so we can include topic context per batch
    const byTopic = new Map<string, typeof items>()
    for (const it of items) {
      const list = byTopic.get(it.topic_id) ?? []
      list.push(it)
      byTopic.set(it.topic_id, list)
    }

    const queueIds: string[] = []
    for (const [topicId, topicItems] of byTopic) {
      const { data: topic } = await supabaseAdmin
        .from('topics')
        .select('id, title')
        .eq('id', topicId)
        .maybeSingle()

      const t = topic as { id: string; title: string } | null
      if (!t) continue

      const formatted = topicItems
        .map((c) => {
          const previewText = c.type === 'story' ? c.content : c.caption ?? '(media only)'
          return `- id=${c.id} | ${c.contributor_name} | ${c.type} | "${(previewText ?? '').slice(0, 200)}"`
        })
        .join('\n')

      const userPrompt = [
        `Topic: ${t.title} (${t.id})`,
        '',
        `Pending contributions (${topicItems.length}):`,
        formatted,
        '',
        'Classify each contribution now.',
      ].join('\n')

      const text = await callClaude({
        system: SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 3000,
      })

      const parsed = extractJson<{ decisions: ContributionDecision[] }>(text)

      const batch: ContributionBatch = {
        topic_id: t.id,
        topic_title: t.title,
        decisions: parsed.decisions,
      }

      const queued = await enqueueDraft({
        itemType: 'contribution',
        payload: batch as unknown as Record<string, unknown>,
        sourceAgent: 'contribution_moderator',
        context: { count: parsed.decisions.length },
        relatedTopicId: t.id,
      })

      queueIds.push(queued.id)
    }

    await finishAgentTask(task.id, {
      status: 'succeeded',
      output: { approvalQueueIds: queueIds, batchCount: queueIds.length },
    })

    return { approvalQueueId: queueIds[0] ?? '' }
  } catch (err) {
    await finishAgentTask(task.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
