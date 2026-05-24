/**
 * Sold-out follow-up agent.
 *
 * When `updateArtworkAction` detects an artwork transitioning to
 * sold-out, fires a `sold-out-notice` agent_task (already wired) AND
 * this agent — which drafts a *successor piece* proposal into the
 * approval queue.
 *
 * The successor proposal stays in the same topic + artist voice as
 * the sold-out original, with a fresh subject angle. The operator
 * reviews, approves (then generates the actual artwork through the
 * normal pipeline), or rejects. Lets the brand maintain momentum
 * after a winning piece without the operator having to think of the
 * next one from scratch.
 *
 * Cost: ~$0.005 per call (Sonnet). Failure is non-fatal — the
 * sold-out signal still fires regardless.
 */

import { callClaude, extractJson, DEFAULT_MODEL } from './base';
import { enqueueDraft } from '@/lib/queue';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface SoldOutFollowUpInput {
  artworkId: string;
}

export interface SuccessorProposal {
  /** Suggested title for the successor piece, e.g. "Three Birds at Dusk" */
  successorTitle: string;
  /** Paintable subject phrase the operator can drop into the generator */
  suggestedSubject: string;
  /** Why this riff makes sense as a follow-up — 1-2 sentences */
  rationale: string;
  /** Reuses original's artistId + topicId */
  artistId: string | null;
  topicId: string | null;
}

const SYSTEM_PROMPT = `You're the creative director for ArtInScale. An artwork just sold out. Your job: draft ONE successor-piece proposal that:
- Stays in the same topic + artist voice as the original (so collectors who missed the first piece get something coherent)
- Picks a fresh angle within that topic — not a literal rehash
- Names a concrete, paintable subject (not an abstract feeling)
- Reads as inevitable, not random

Output JSON only — no prose. Schema:
{
  "successorTitle": "string ≤ 60 chars — feels like a sibling of the original title",
  "suggestedSubject": "string ≤ 90 chars — concrete visual subject the artist can depict",
  "rationale": "string ≤ 240 chars — 1-2 sentences on why this riff works as a follow-up"
}`;

export async function runSoldOutFollowUp(
  args: SoldOutFollowUpInput
): Promise<{ artworkId: string; queueItemId: string | null; proposal: SuccessorProposal | null }> {
  const { data: artwork, error } = await supabaseAdmin
    .from('artworks')
    .select(
      'id, title, description, inspiration_summary, edition_size, edition_sold, topic_id, artist_id'
    )
    .eq('id', args.artworkId)
    .single();
  if (error || !artwork) {
    throw new Error(`Artwork not found: ${error?.message ?? args.artworkId}`);
  }

  const [{ data: topic }, { data: artist }] = await Promise.all([
    artwork.topic_id
      ? supabaseAdmin
          .from('topics')
          .select('id, title, description, long_description')
          .eq('id', artwork.topic_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    artwork.artist_id
      ? supabaseAdmin
          .from('users')
          .select('id, name, bio')
          .eq('id', artwork.artist_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Pull a few approved contributions from the topic so the LLM has
  // ground truth, not just a topic title. Same source the cluster
  // picker uses.
  let contributionExcerpts: string[] = [];
  if (artwork.topic_id) {
    const { data: contribs } = await supabaseAdmin
      .from('topic_contributions')
      .select('type, contributor_name, content, caption')
      .eq('topic_id', artwork.topic_id)
      .eq('status', 'approved')
      .eq('show_publicly', true)
      .order('created_at', { ascending: false })
      .limit(8);
    contributionExcerpts = (contribs ?? [])
      .map((c) => {
        const r = c as { type: string; contributor_name: string; content?: string | null; caption?: string | null };
        const text = r.type === 'story' ? r.content ?? '' : r.caption ?? '';
        const trimmed = text.trim().slice(0, 180);
        return trimmed ? `${r.contributor_name}: "${trimmed}"` : null;
      })
      .filter((s): s is string => Boolean(s));
  }

  const userPrompt = `An artwork by ${artist?.name ?? 'an Artinscale artist'} just sold out. Draft one successor piece.

Sold-out original:
- Title: ${artwork.title}
- Synopsis: ${artwork.description ?? '(none)'}
- Inspiration: ${artwork.inspiration_summary ?? '(none)'}
- Edition: sold ${artwork.edition_sold ?? 0} of ${artwork.edition_size ?? '?'}

Topic: "${topic?.title ?? '(none)'}"
${topic?.long_description ?? topic?.description ?? ''}

Artist voice: ${artist?.bio ?? '(none)'}

${contributionExcerpts.length > 0 ? `Contributions that fed this topic:\n${contributionExcerpts.map((e) => `  - ${e}`).join('\n')}` : ''}

Draft the successor. JSON only.`;

  const text = await callClaude({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    model: DEFAULT_MODEL,
    maxTokens: 500,
  });

  let parsed: Partial<SuccessorProposal>;
  try {
    parsed = extractJson<Partial<SuccessorProposal>>(text);
  } catch {
    // Model returned malformed JSON — don't block the sold-out signal.
    return { artworkId: artwork.id, queueItemId: null, proposal: null };
  }
  const successorTitle = (parsed.successorTitle ?? '').trim().slice(0, 80);
  const suggestedSubject = (parsed.suggestedSubject ?? '').trim().slice(0, 140);
  const rationale = (parsed.rationale ?? '').trim().slice(0, 300);
  if (!successorTitle || !suggestedSubject) {
    return { artworkId: artwork.id, queueItemId: null, proposal: null };
  }

  const proposal: SuccessorProposal = {
    successorTitle,
    suggestedSubject,
    rationale,
    artistId: artwork.artist_id ?? null,
    topicId: artwork.topic_id ?? null,
  };

  // Land in the approval queue as an 'artwork' draft. Payload shape
  // mirrors what an artwork form would consume: the operator clicks
  // through, the generator opens preloaded with the suggested subject
  // and the right artist/topic.
  const queueItem = await enqueueDraft({
    itemType: 'artwork',
    sourceAgent: 'sold-out-follow-up',
    payload: {
      successorTitle,
      suggestedSubject,
      rationale,
      derivedFromArtworkId: artwork.id,
      derivedFromTitle: artwork.title,
      artistId: artwork.artist_id,
      topicId: artwork.topic_id,
    },
    context: {
      sold_out_artwork_id: artwork.id,
      edition_size: artwork.edition_size,
      contribution_excerpts: contributionExcerpts.slice(0, 3),
    },
    relatedArtworkId: artwork.id,
    relatedTopicId: artwork.topic_id ?? null,
  });

  return { artworkId: artwork.id, queueItemId: queueItem.id, proposal };
}
