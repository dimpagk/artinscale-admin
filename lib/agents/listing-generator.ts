/**
 * Listing-generator agent.
 *
 * Generates SEO + social-share copy for an artwork's Shopify listing.
 * Stores the result in `artworks.listing_meta` so the sync library can
 * push it to Shopify metafields without re-calling the model.
 *
 * Scope: only fields with no canonical source. Title, description,
 * tags, vendor, price, collections — those come from the admin DB and
 * go through `listing-sync` directly. The agent stays out of their
 * way.
 *
 * Cost per call: ~$0.005 (Sonnet, ~600 in / ~300 out tokens).
 *
 * Idempotent: a run with `force=false` is a no-op when seoTitle is
 * already set. Manual edits in the admin UI flip `generatedBy` to
 * 'manual', which the agent respects (won't overwrite a manual edit
 * unless the operator explicitly forces).
 */

import { callClaude, extractJson, DEFAULT_MODEL } from './base';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  EMPTY_LISTING_META,
  type ListingMeta,
} from '@/lib/types';
import { getTemplateConfig } from '@/lib/gelato-templates';

export interface GenerateListingMetaInput {
  artworkId: string;
  /** Re-generate even if listing_meta is already populated. */
  force?: boolean;
}

export interface GenerateListingMetaResult {
  artworkId: string;
  listingMeta: ListingMeta;
  /** True when the existing meta was already complete and we skipped the model call. */
  skipped: boolean;
}

const SYSTEM_PROMPT = `You write SEO and social-share copy for fine-art prints sold on Shopify by ArtInScale, a premium brand that turns community-contributed stories into archival art prints.

Your job: produce four short copy fields based on the artwork details provided. Return JSON only, matching the schema exactly. No prose outside the JSON.

Schema:
{
  "seoTitle": "string ≤60 chars, Title Case, includes artwork title + a value descriptor (e.g. 'Archival Matte Print'). Avoid clickbait. Avoid 'Buy Now' / '!!!' / emojis.",
  "seoDescription": "string ≤160 chars, search snippet. Sentence case. Should describe what the print is, evoke the artwork's mood, hint at the story behind it. Plain text, no HTML.",
  "ogTitle": "string ≤60 chars, slightly more poetic than seoTitle. This is what appears when someone shares the link on social media.",
  "ogDescription": "string ≤200 chars, social share copy. Should make a reader stop scrolling. Concrete, not abstract. Plain text."
}

Rules:
- Do not invent facts. Only use what's in the input. NEVER invent an edition count, a print run, or a size; the Edition and Format lines in the brief are the only source of truth for those.
- Say "Limited Edition" ONLY if the Edition line literally says "Limited edition of N", and then use exactly that N. When it says "Open edition", never use the words "limited" or "edition of"; either say nothing about editions or lean on craft ("archival", "made to order").
- The product language is "archival matte print" (matches the website). Never "museum-quality".
- Never use em dashes; use a comma, a colon, or two sentences instead.
- Do not echo the description verbatim; these are complements to the existing product description, not duplicates.
- The size descriptor (e.g. "50x70 cm") goes only where the Format line provides it, and only in seoTitle if there's room without crowding.
- If the topic title is provided, weave it into ogDescription naturally. Don't force it into seoTitle.`;

export async function generateListingMeta(
  args: GenerateListingMetaInput
): Promise<GenerateListingMetaResult> {
  const { data: artwork, error } = await supabaseAdmin
    .from('artworks')
    .select(
      'id, title, description, inspiration_summary, edition_size, product_type, listing_meta, topic_id, artist_id'
    )
    .eq('id', args.artworkId)
    .single();
  if (error || !artwork) {
    throw new Error(`Artwork not found: ${error?.message ?? args.artworkId}`);
  }

  const existing: ListingMeta = artwork.listing_meta ?? EMPTY_LISTING_META;

  // Skip if already populated and not forced. This is the idempotent
  // path so callers (e.g. pushToGelatoAction) can run blindly without
  // wasting model calls.
  if (
    !args.force &&
    existing.seoTitle &&
    existing.seoDescription &&
    existing.ogTitle &&
    existing.ogDescription
  ) {
    return { artworkId: artwork.id, listingMeta: existing, skipped: true };
  }

  // If a manual edit is in place and not forced, also skip — operator
  // overrides take priority.
  if (!args.force && existing.generatedBy === 'manual') {
    return { artworkId: artwork.id, listingMeta: existing, skipped: true };
  }

  // Gather context
  const [{ data: topic }, { data: artist }] = await Promise.all([
    artwork.topic_id
      ? supabaseAdmin
          .from('topics')
          .select('title, description')
          .eq('id', artwork.topic_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    artwork.artist_id
      ? supabaseAdmin
          .from('users')
          .select('name, bio')
          .eq('id', artwork.artist_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const config = getTemplateConfig(artwork.product_type);
  const sizeStr = config
    ? `${config.widthCm}×${config.heightCm} cm`
    : null;

  const editionLabel =
    artwork.edition_size != null
      ? `Limited edition of ${artwork.edition_size}`
      : 'Open edition';

  const userPrompt = `Artwork details:
- Title: ${artwork.title}
- Description: ${artwork.description ?? '(none)'}
- Inspiration summary: ${artwork.inspiration_summary ?? '(none)'}
- Edition: ${editionLabel}
- Format: Archival matte print${sizeStr ? `, ${sizeStr}` : ''}
- Topic: ${topic ? `"${topic.title}" — ${topic.description ?? ''}` : '(none)'}
- Artist: ${artist?.name ?? '(unknown)'}${artist?.bio ? ` — ${artist.bio.slice(0, 200)}` : ''}

Generate the four copy fields. JSON only.`;

  const text = await callClaude({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    model: DEFAULT_MODEL,
    maxTokens: 800,
  });

  const parsed = extractJson<Partial<ListingMeta>>(text);

  // Sanitize: enforce length limits, fall back to existing or null.
  const next: ListingMeta = {
    seoTitle: clip(parsed.seoTitle, 60) ?? existing.seoTitle,
    seoDescription: clip(parsed.seoDescription, 160) ?? existing.seoDescription,
    ogTitle: clip(parsed.ogTitle, 60) ?? existing.ogTitle,
    ogDescription: clip(parsed.ogDescription, 200) ?? existing.ogDescription,
    generatedAt: new Date().toISOString(),
    generatedBy: 'agent',
  };

  const { error: updErr } = await supabaseAdmin
    .from('artworks')
    .update({ listing_meta: next })
    .eq('id', artwork.id);
  if (updErr) {
    throw new Error(`Failed to persist listing_meta: ${updErr.message}`);
  }

  return { artworkId: artwork.id, listingMeta: next, skipped: false };
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}
