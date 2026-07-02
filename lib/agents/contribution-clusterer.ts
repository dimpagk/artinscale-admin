/**
 * Contribution clusterer.
 *
 * Groups a topic's approved contributions into 3–5 thematic clusters
 * using Gemini 2.5 Flash. Each cluster surfaces in the art generator
 * UI as a chip the operator can pick — generation then uses only
 * that cluster's contributions (and the suggested subject phrase) so
 * the produced artwork is anchored to a specific narrative thread,
 * not a topic-wide average.
 *
 * Why Flash and not Claude: pure classification + light synthesis
 * task, no chain-of-thought needed. Gemini Flash is ~10× cheaper
 * (~$0.001 per topic of 30 contributions) and 5× faster (~3s).
 *
 * Cache strategy: persisted to `topics.contribution_clusters` JSONB
 * (migration 020). Re-run when:
 *   - operator clicks "Refresh clusters" → force=true
 *   - contributionsCount has drifted ≥10 since last cluster run
 *
 * Output shape mirrors what the UI consumes in
 * components/art-generator/clustered-topic-context-picker.tsx.
 */

import { GoogleGenAI } from '@google/genai';
import { supabaseAdmin } from '@/lib/supabase/admin';

const GEMINI_MODEL = 'gemini-2.5-flash';

export interface ContributionCluster {
  /** kebab-case slug, derived from title — stable identifier for UI */
  id: string;
  /** human-readable theme label, ~1–4 words */
  title: string;
  /** one-sentence description of what unites the contributions */
  description: string;
  /** uuids of the contributions that landed in this cluster */
  contributionIds: string[];
  /** short subject phrase the operator can paste into the prompt */
  suggestedSubject: string;
}

export interface ContributionClustering {
  generatedAt: string;
  contributionsCount: number;
  clusters: ContributionCluster[];
}

interface ContributionForClustering {
  id: string;
  type: string;
  contributor_name: string;
  content: string | null;
  caption: string | null;
}

const SYSTEM_PROMPT = `You are clustering community contributions to a creative-prompt topic. The contributions are short personal stories / photo captions / link descriptions submitted by different people who interpret the topic in their own way. Your job is to group them into 3–5 thematic clusters so an artist can pick one specific narrative angle.

Output JSON only — no prose. Schema:
{
  "clusters": [
    {
      "title": "string ≤ 4 words — the thematic angle (e.g. 'Morning calm', 'Last breath of a parent')",
      "description": "string ≤ 140 chars — one sentence summarizing what unites these contributions",
      "contributionIds": ["uuid", ...],
      "suggestedSubject": "string ≤ 90 chars — concrete visual subject for an artist (e.g. 'a hand reaching toward dawn light', 'two birds at first light'). Should evoke the cluster's theme but be paintable, not abstract."
    },
    ...
  ]
}

Rules:
- Aim for 3–5 clusters. Less than 3 if contributions are very similar; never more than 5.
- Every contributionId in the input must appear in exactly one cluster.
- Cluster titles should be specific to THIS topic, not generic ("Stories" / "Memories" / "Photos" are bad).
- suggestedSubject must be a paintable scene, not an abstract idea. Concrete nouns over feelings.`;

export interface ClusterContributionsArgs {
  topicId: string;
  /** Re-cluster even if cached output looks current. */
  force?: boolean;
  /**
   * Recompute when the contributionsCount has drifted by more than
   * this many since the last clustering. Defaults to 10. Set to 0 to
   * always recompute, Infinity to never auto-recompute.
   */
  driftThreshold?: number;
}

export interface ClusterContributionsResult {
  topicId: string;
  clustering: ContributionClustering;
  skipped: boolean;
}

export async function clusterTopicContributions(
  args: ClusterContributionsArgs
): Promise<ClusterContributionsResult> {
  const driftThreshold = args.driftThreshold ?? 10;

  const { data: topic, error: topicErr } = await supabaseAdmin
    .from('topics')
    .select('id, title, description, contribution_clusters')
    .eq('id', args.topicId)
    .single();
  if (topicErr || !topic) {
    throw new Error(`Topic not found: ${topicErr?.message ?? args.topicId}`);
  }

  const { data: contribs, error: contribErr } = await supabaseAdmin
    .from('topic_contributions')
    .select('id, type, contributor_name, content, caption')
    .eq('topic_id', args.topicId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(60); // capped — past 60 contributions, the marginal classification value drops fast
  if (contribErr) {
    throw new Error(`Failed to load contributions: ${contribErr.message}`);
  }
  const contributions = (contribs ?? []) as ContributionForClustering[];

  if (contributions.length < 3) {
    // Not enough material to cluster — return a single bucket. The UI
    // hides the cluster picker when there's only one bucket.
    const singleCluster: ContributionClustering = {
      generatedAt: new Date().toISOString(),
      contributionsCount: contributions.length,
      clusters:
        contributions.length === 0
          ? []
          : [
              {
                id: 'all',
                title: 'All contributions',
                description: `Every contribution submitted to ${topic.title} so far.`,
                contributionIds: contributions.map((c) => c.id),
                suggestedSubject: '',
              },
            ],
    };
    await persist(args.topicId, singleCluster);
    return { topicId: args.topicId, clustering: singleCluster, skipped: false };
  }

  // Idempotency check
  const cached = (topic.contribution_clusters ?? null) as ContributionClustering | null;
  if (!args.force && cached && cached.clusters.length > 0) {
    const drift = Math.abs(cached.contributionsCount - contributions.length);
    if (drift <= driftThreshold) {
      return { topicId: args.topicId, clustering: cached, skipped: true };
    }
  }

  // Build the user prompt
  const lines = contributions
    .map((c) => {
      const text = (c.type === 'story' ? c.content : c.caption ?? '') ?? '';
      const trimmed = text.trim().slice(0, 220);
      if (!trimmed) return null;
      return `id=${c.id} | ${c.contributor_name} (${c.type}): "${trimmed}"`;
    })
    .filter((s): s is string => s != null);

  const userPrompt = `Topic: "${topic.title}" — ${topic.description ?? ''}

Contributions to cluster (${lines.length} total):
${lines.join('\n')}

Cluster these into 3–5 thematic groups. JSON only.`;

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  });
  const responseText = response.text ?? '';

  let parsed: { clusters?: Array<Partial<ContributionCluster>> };
  try {
    parsed = JSON.parse(responseText);
  } catch (err) {
    throw new Error(
      `Clusterer returned invalid JSON: ${err instanceof Error ? err.message : String(err)}. First 300 chars: ${responseText.slice(0, 300)}`
    );
  }

  const validIdSet = new Set(contributions.map((c) => c.id));
  const seenIds = new Set<string>();
  const clusters: ContributionCluster[] = [];
  for (const c of parsed.clusters ?? []) {
    const title = (c.title ?? '').trim().slice(0, 60);
    if (!title) continue;
    const ids = Array.isArray(c.contributionIds)
      ? c.contributionIds.filter(
          (id): id is string => typeof id === 'string' && validIdSet.has(id) && !seenIds.has(id)
        )
      : [];
    if (ids.length === 0) continue;
    for (const id of ids) seenIds.add(id);
    clusters.push({
      id: slugify(title),
      title,
      description: (c.description ?? '').trim().slice(0, 200),
      contributionIds: ids,
      suggestedSubject: (c.suggestedSubject ?? '').trim().slice(0, 140),
    });
  }

  // Backstop: any contributions the model missed get put in a
  // catch-all cluster so the UI doesn't silently drop them.
  const missed = contributions.filter((c) => !seenIds.has(c.id));
  if (missed.length > 0) {
    clusters.push({
      id: 'other',
      title: 'Other contributions',
      description: 'Contributions that didn\'t fit cleanly into the main themes.',
      contributionIds: missed.map((c) => c.id),
      suggestedSubject: '',
    });
  }

  const clustering: ContributionClustering = {
    generatedAt: new Date().toISOString(),
    contributionsCount: contributions.length,
    clusters,
  };
  await persist(args.topicId, clustering);
  return { topicId: args.topicId, clustering, skipped: false };
}

async function persist(topicId: string, clustering: ContributionClustering): Promise<void> {
  const { error } = await supabaseAdmin
    .from('topics')
    .update({ contribution_clusters: clustering })
    .eq('id', topicId);
  if (error) throw new Error(`Failed to persist clusters: ${error.message}`);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'cluster';
}
