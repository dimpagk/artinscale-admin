/**
 * Topic ideator.
 *
 * Cron: weekly. Proposes 2-3 candidate topics for upcoming launches,
 * informed by:
 *   - Recent operator decisions on prior topic drafts
 *   - Existing topic titles (avoid duplicates)
 *   - Seasonal calendar (rough — model handles)
 *
 * Each proposal lands as a separate approval_queue row with item_type='topic'
 * so the operator can approve/edit/reject individually.
 */

import { callClaude, extractJson, loadFewShot, startAgentTask, finishAgentTask } from './base'
import { enqueueDraft } from '@/lib/queue'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface TopicProposal {
  slug_suggestion: string  // e.g. 'first-light'
  title: string
  short_description: string
  long_description: string
  contribution_types: Array<'story' | 'photo' | 'sound' | 'link'>
  prompts: string[]  // questions to ask community
  rationale: string  // why now, why this
}

const SYSTEM_PROMPT = `You are a creative director for ArtInScale, an artist-driven platform that turns community contributions (stories, photos, sounds) into limited-edition prints.

Your job: propose 2-3 candidate topics for upcoming launches. Each topic should:
- Be broad enough that 3 distinct AI artists can each interpret it through their own visual voice
- Be concrete enough that real people can contribute personal experiences
- Avoid duplicating existing topics (provided)
- Lean into emotional, sensory, or seasonal hooks

Output format: a JSON object with the exact shape:
{
  "proposals": [
    {
      "slug_suggestion": "first-light",
      "title": "First Light",
      "short_description": "...one-sentence hook...",
      "long_description": "...2-3 sentence elaboration that gives contributors a clear angle...",
      "contribution_types": ["story", "photo", "sound", "link"],
      "prompts": ["...3-5 prompt questions to ask the community..."],
      "rationale": "..why now, why this..."
    },
    ...
  ]
}`

export async function runTopicIdeator(args?: {
  triggerKind?: 'cron' | 'manual'
  triggerKey?: string
}): Promise<{ approvalQueueIds: string[] } | { skipped: 'already_running' }> {
  const task = await startAgentTask({
    agentName: 'topic_ideator',
    triggerKind: args?.triggerKind ?? 'cron',
    triggerKey: args?.triggerKey ?? `weekly-${new Date().toISOString().slice(0, 10)}`,
    input: {},
  })

  if (!task) return { skipped: 'already_running' }

  try {
    const { data: existingTopics } = await supabaseAdmin
      .from('topics')
      .select('id, title, status')
      .order('created_at', { ascending: false })
      .limit(20)

    const existingList = (existingTopics ?? [])
      .map((t) => {
        const row = t as { id: string; title: string; status: string }
        return `- ${row.title} (${row.id}, ${row.status})`
      })
      .join('\n')

    const fewShot = await loadFewShot('topic')

    const today = new Date()
    const userPrompt = [
      `Today's date: ${today.toISOString().slice(0, 10)}`,
      `Northern hemisphere season hint: ${seasonHint(today)}`,
      '',
      `Existing topics (avoid duplicates):\n${existingList || '(none yet)'}`,
      '',
      fewShot,
      '',
      'Propose 2-3 new candidate topics now.',
    ].join('\n')

    const text = await callClaude({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 2000,
    })

    const parsed = extractJson<{ proposals: TopicProposal[] }>(text)

    if (!Array.isArray(parsed.proposals) || parsed.proposals.length === 0) {
      throw new Error('Expected at least one topic proposal')
    }

    const queueIds: string[] = []
    for (const proposal of parsed.proposals.slice(0, 3)) {
      const queued = await enqueueDraft({
        itemType: 'topic',
        payload: proposal as unknown as Record<string, unknown>,
        sourceAgent: 'topic_ideator',
        context: { season: seasonHint(today) },
      })
      queueIds.push(queued.id)
    }

    await finishAgentTask(task.id, {
      status: 'succeeded',
      output: { approvalQueueIds: queueIds, count: queueIds.length },
    })

    return { approvalQueueIds: queueIds }
  } catch (err) {
    await finishAgentTask(task.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

function seasonHint(date: Date): string {
  const month = date.getMonth() + 1
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}
