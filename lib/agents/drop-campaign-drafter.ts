/**
 * Drop campaign drafter.
 *
 * Trigger: artwork transitions to status='listed'.
 * Output:  one approval_queue row with item_type='social_campaign'
 *          containing 5 drafted posts (announcement, artist process,
 *          contribution quote, palette study, lifestyle mockup).
 *
 * Highest-leverage launch agent — turns 1 piece of inventory into 5
 * pieces of marketing content.
 */

import { callClaude, extractJson, loadFewShot, startAgentTask, finishAgentTask } from './base'
import { enqueueDraft } from '@/lib/queue'
import { getArtworkById } from '@/lib/artworks'
import { getStylePackForArtistAsync } from '@/lib/style-packs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface DraftedPost {
  kind: 'announcement' | 'artist_process' | 'contribution_quote' | 'palette_study' | 'lifestyle_mockup'
  caption: string
  hashtags: string[]
  call_to_action: string
  visual_brief: string
  ai_disclosure: string
}

export interface DropCampaign {
  artwork_id: string
  artwork_title: string
  artist_name: string
  topic_id: string | null
  topic_title: string | null
  posts: DraftedPost[]
}

const SYSTEM_PROMPT = `You are the social media director for ArtInScale, an artist-driven art platform powered by AI artists who interpret real community contributions into limited-edition prints.

Your job: draft a 5-post drop campaign for a single artwork. Each post must:
- Match the artist's voice (provided in the brief)
- Reference the topic origin and community contributions (provided)
- Comply with Meta's AI-content disclosure: include a clear ai_disclosure phrase ("Made by an AI-augmented artist", or similar)
- Be platform-agnostic enough to work on both Instagram and Facebook

Output format: a JSON object with the exact shape:
{
  "posts": [
    {
      "kind": "announcement" | "artist_process" | "contribution_quote" | "palette_study" | "lifestyle_mockup",
      "caption": "...full caption text...",
      "hashtags": ["#tag1", "#tag2", ...],
      "call_to_action": "Short CTA text",
      "visual_brief": "Brief description of the visual that should accompany this post",
      "ai_disclosure": "Short disclosure phrase to include or label"
    },
    ... 5 posts total, one per kind ...
  ]
}

Avoid generic platitudes. Reference the specific topic, the specific contribution snippets, and the specific artist persona.`

export async function runDropCampaignDrafter(args: {
  artworkId: string
  triggerKind?: 'event' | 'manual'
}): Promise<{ approvalQueueId: string } | { skipped: 'already_running' }> {
  const task = await startAgentTask({
    agentName: 'drop_campaign_drafter',
    triggerKind: args.triggerKind ?? 'event',
    triggerKey: args.artworkId,
    input: { artworkId: args.artworkId },
  })

  if (!task) return { skipped: 'already_running' }

  try {
    const artwork = await getArtworkById(args.artworkId)
    if (!artwork) throw new Error(`Artwork ${args.artworkId} not found`)

    // Pull the style pack persona based on the artwork's artist.
    // DB-aware so operator edits via /styles are honored.
    const stylePack = await getStylePackForArtistAsync(artwork.users?.id ?? null)
    const stylePackId = stylePack?.id ?? null
    const artistVoice = stylePack
      ? `${stylePack.persona.name} — ${stylePack.persona.tagline}\nProcess: ${stylePack.persona.processMd}`
      : artwork.users?.name ?? 'Unknown artist'

    // Pull contribution excerpts if topic is linked
    let contributionExcerpts: string[] = []
    let topicTitle: string | null = null
    if (artwork.topic_id) {
      const { data: topic } = await supabaseAdmin
        .from('topics')
        .select('id, title')
        .eq('id', artwork.topic_id)
        .maybeSingle()
      topicTitle = (topic as { title?: string } | null)?.title ?? null

      const { data: contributions } = await supabaseAdmin
        .from('topic_contributions')
        .select('contributor_name, type, content, caption')
        .eq('topic_id', artwork.topic_id)
        .eq('status', 'approved')
        .eq('show_publicly', true)
        .limit(5)

      contributionExcerpts = (contributions ?? []).map((c) => {
        const row = c as { contributor_name?: string; type?: string; content?: string; caption?: string }
        const isStory = row.type === 'story'
        const text = isStory ? row.content : row.caption || ''
        return `${row.contributor_name ?? 'Anonymous'}: "${(text ?? '').slice(0, 200)}"`
      })
    }

    const fewShot = await loadFewShot('social_campaign')

    const userPrompt = [
      `Artwork: "${artwork.title}"`,
      artwork.description ? `Description: ${artwork.description}` : '',
      `Artist voice: ${artistVoice}`,
      topicTitle ? `Topic: ${topicTitle}` : 'No topic linked',
      contributionExcerpts.length
        ? `Community contributions to draw from:\n${contributionExcerpts.map((c) => `  - ${c}`).join('\n')}`
        : 'No public contributions available — keep references general.',
      '',
      fewShot,
      '',
      'Draft the 5-post campaign now.',
    ]
      .filter(Boolean)
      .join('\n')

    const text = await callClaude({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 3000,
    })

    const parsed = extractJson<{ posts: DraftedPost[] }>(text)

    if (!Array.isArray(parsed.posts) || parsed.posts.length !== 5) {
      throw new Error(
        `Expected 5 posts, got ${Array.isArray(parsed.posts) ? parsed.posts.length : 'non-array'}`
      )
    }

    const campaign: DropCampaign = {
      artwork_id: artwork.id,
      artwork_title: artwork.title,
      artist_name: artwork.users?.name ?? 'Unknown artist',
      topic_id: artwork.topic_id,
      topic_title: topicTitle,
      posts: parsed.posts,
    }

    const queued = await enqueueDraft({
      itemType: 'social_campaign',
      payload: campaign as unknown as Record<string, unknown>,
      sourceAgent: 'drop_campaign_drafter',
      context: { stylePackId, contributionCount: contributionExcerpts.length },
      relatedArtworkId: artwork.id,
      relatedTopicId: artwork.topic_id,
    })

    await finishAgentTask(task.id, {
      status: 'succeeded',
      output: { approvalQueueId: queued.id, postCount: parsed.posts.length },
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

