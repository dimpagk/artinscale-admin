/**
 * Comment reply drafter.
 *
 * Trigger: a new row appears in `comment_threads` with status='open'.
 * Output:  classification + drafted reply in approval_queue,
 *          item_type='comment_reply'.
 *
 * The reply is drafted in the artist's voice when the comment is on a
 * post linked to a known artist persona, otherwise in the brand voice.
 */

import { callClaude, extractJson, loadFewShot, startAgentTask, finishAgentTask } from './base'
import { enqueueDraft } from '@/lib/queue'
import { getStylePackForArtistAsync } from '@/lib/style-packs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type CommentClassification =
  | 'question'
  | 'compliment'
  | 'objection'
  | 'sale_intent'
  | 'spam'
  | 'other'

export interface CommentReplyDraft {
  thread_id: string
  classification: CommentClassification
  reply_text: string
  reasoning: string
  flag_for_human: boolean
  flag_reason?: string
}

const SYSTEM_PROMPT = `You are drafting a reply to a comment or DM on ArtInScale's social channels.

Output JSON of the exact shape:
{
  "classification": "question" | "compliment" | "objection" | "sale_intent" | "spam" | "other",
  "reply_text": "...short, warm, in-voice reply...",
  "reasoning": "...one sentence on why you classified this way and chose this reply tone...",
  "flag_for_human": true | false,
  "flag_reason": "...required if flag_for_human=true..."
}

Always flag_for_human=true and provide a flag_reason when:
- The comment mentions price disputes, refunds, shipping problems, or legal language
- The comment is hostile, harassing, or discriminatory
- The comment seems to be from a journalist or partnership inquiry
- You are unsure of the right response

Otherwise, draft a short reply (1-3 sentences) in the indicated voice.`

export async function runCommentReplyDrafter(args: {
  threadId: string
  triggerKind?: 'event' | 'manual'
}): Promise<{ approvalQueueId: string } | { skipped: 'already_running' | 'thread_closed' }> {
  const task = await startAgentTask({
    agentName: 'comment_reply_drafter',
    triggerKind: args.triggerKind ?? 'event',
    triggerKey: args.threadId,
    input: { threadId: args.threadId },
  })

  if (!task) return { skipped: 'already_running' }

  try {
    const { data: thread } = await supabaseAdmin
      .from('comment_threads')
      .select('*')
      .eq('id', args.threadId)
      .maybeSingle()

    if (!thread) throw new Error(`comment_thread ${args.threadId} not found`)
    const t = thread as {
      id: string
      platform: string
      initial_text: string
      author_name: string | null
      status: string
      related_artwork_id: string | null
    }

    if (t.status !== 'open') {
      await finishAgentTask(task.id, {
        status: 'cancelled',
        output: { reason: 'thread_not_open', status: t.status },
      })
      return { skipped: 'thread_closed' }
    }

    // Try to infer artist voice from related artwork
    let voiceContext = 'Brand voice: warm, curatorial, never salesy. ArtInScale is a story-driven art platform.'
    if (t.related_artwork_id) {
      const { data: artwork } = await supabaseAdmin
        .from('artworks')
        .select('artist_id')
        .eq('id', t.related_artwork_id)
        .maybeSingle()

      const artistId = (artwork as { artist_id?: string } | null)?.artist_id
      const pack = await getStylePackForArtistAsync(artistId)
      if (pack) {
        voiceContext = `Speak in the voice of ${pack.persona.name} — ${pack.persona.tagline}. Tone: ${pack.persona.processMd.slice(0, 200)}`
      }
    }

    const fewShot = await loadFewShot('comment_reply')

    const userPrompt = [
      `Platform: ${t.platform}`,
      `Author: ${t.author_name ?? 'Unknown'}`,
      `Comment: "${t.initial_text}"`,
      '',
      voiceContext,
      '',
      fewShot,
      '',
      'Classify the comment and draft a reply now.',
    ].join('\n')

    const text = await callClaude({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 1000,
    })

    const parsed = extractJson<Omit<CommentReplyDraft, 'thread_id'>>(text)
    const draft: CommentReplyDraft = {
      thread_id: t.id,
      ...parsed,
    }

    const queued = await enqueueDraft({
      itemType: 'comment_reply',
      payload: draft as unknown as Record<string, unknown>,
      sourceAgent: 'comment_reply_drafter',
      context: { platform: t.platform, classification: draft.classification },
      relatedArtworkId: t.related_artwork_id,
    })

    // Update the thread to record the draft id (so we can find it later)
    await supabaseAdmin
      .from('comment_threads')
      .update({
        classification: draft.classification,
        reply_approval_queue_id: queued.id,
      })
      .eq('id', t.id)

    await finishAgentTask(task.id, {
      status: 'succeeded',
      output: { approvalQueueId: queued.id, classification: draft.classification, flagged: draft.flag_for_human },
    })

    return { approvalQueueId: queued.id }
  } catch (err) {
    await finishAgentTask(task.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

