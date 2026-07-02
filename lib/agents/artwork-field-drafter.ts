/**
 * Artwork field-drafter agent.
 *
 * Drafts a complete set of listing fields for an artwork so the operator
 * can review everything in one pass on the edit page: title, storefront
 * description, SEO/OG copy, plus deterministic suggestions for product
 * size (from image resolution via the upscale plan) and price/edition
 * (from PRODUCT_DEFAULTS).
 *
 * Unlike generateListingMeta this performs NO database writes: it returns
 * a pure draft that the form fills in as highlighted suggestions, and
 * nothing persists until the operator hits Save. That keeps the review
 * semantics honest ("propose everything, I decide").
 *
 * Cost per call: ~$0.01 (Sonnet, one call covers all six text fields).
 */

import { callClaude, extractJson, DEFAULT_MODEL } from './base';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getTemplateConfig, planUpscaleForBase } from '@/lib/gelato-templates';
import { getProductDefaults } from '@/lib/pricing-defaults';
import { fetchImageDimensions } from '@/lib/image-dimensions';

export interface ArtworkFieldSuggestions {
  title: string | null;
  description: string | null;
  productType: string | null;
  price: number | null;
  editionSize: number | null;
  currency: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
}

export interface ArtworkFieldDraft {
  artworkId: string;
  suggestions: ArtworkFieldSuggestions;
}

const SYSTEM_PROMPT = `You write product copy for fine-art prints sold on Shopify by ArtInScale, a brand that turns community-contributed stories into limited-edition prints.

Your job: draft six copy fields from the artwork details provided. Return JSON only, matching the schema exactly. No prose outside the JSON.

Schema:
{
  "title": "string <=60 chars. A short, evocative artwork title in Title Case. Not a sentence, not a literal restatement of the image prompt. No quotes, no trailing punctuation.",
  "description": "string, 2 short paragraphs separated by a blank line. The storefront story of the piece: what it depicts, the feeling it carries, and (if a topic is given) how it grew from that collection. Plain text, no HTML, no markdown, 60-120 words total.",
  "seoTitle": "string <=60 chars. Title Case, includes the artwork title + a value descriptor (e.g. 'Limited Edition Art Print' or 'Museum-Quality Matte Print'). Avoid clickbait, 'Buy Now', '!!!', emojis.",
  "seoDescription": "string <=160 chars. Search snippet, sentence case. Describe what the print is, evoke the mood, hint at the story. Plain text.",
  "ogTitle": "string <=60 chars. Slightly more poetic than seoTitle. This appears when the link is shared on social media.",
  "ogDescription": "string <=200 chars. Social share copy that makes a reader stop scrolling. Concrete, not abstract. Plain text."
}

Rules:
- Do not invent facts. Only use what's in the input.
- Never use em dashes anywhere. Use commas, colons, or hyphens instead.
- 'Limited Edition' framing only when an edition size is given; otherwise say 'Open Edition' or skip it.
- The physical size (e.g. '21x30 cm') may appear in seoTitle only if it fits without crowding.
- If a topic is given, weave it into the description and ogDescription naturally. Don't force it into titles.
- Write in the artist's register when a bio is provided, but never impersonate or quote them.`;

export async function draftArtworkFields(artworkId: string): Promise<ArtworkFieldDraft> {
  const { data: artwork, error } = await supabaseAdmin
    .from('artworks')
    .select(
      'id, title, description, inspiration_summary, edition_size, price, currency, product_type, image_url, topic_id, artist_id'
    )
    .eq('id', artworkId)
    .single();
  if (error || !artwork) {
    throw new Error(`Artwork not found: ${error?.message ?? artworkId}`);
  }

  // Context + deterministic suggestions in parallel with each other.
  const [{ data: topic }, { data: artist }, productType] = await Promise.all([
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
    suggestProductType(artwork.product_type, artwork.image_url),
  ]);

  // Price/edition/currency follow the (possibly newly suggested) size.
  const defaults = getProductDefaults(productType);

  const config = productType ? getTemplateConfig(productType) : null;
  const sizeStr = config ? `${config.widthCm}x${config.heightCm} cm` : null;
  const editionSize = defaults?.editionSize ?? artwork.edition_size ?? null;
  const editionLabel =
    editionSize != null ? `Limited edition of ${editionSize}` : 'Open edition';

  const userPrompt = `Artwork details:
- Current title (may be a raw image prompt, improve it): ${artwork.title}
- Current description: ${artwork.description ?? '(none)'}
- Inspiration summary (the image's source prompt / story): ${artwork.inspiration_summary ?? '(none)'}
- Edition: ${editionLabel}
- Format: Museum-quality matte print${sizeStr ? `, ${sizeStr}` : ''}
- Topic: ${topic ? `"${topic.title}" - ${topic.description ?? ''}` : '(none)'}
- Artist: ${artist?.name ?? '(unknown)'}${artist?.bio ? ` - ${artist.bio.slice(0, 300)}` : ''}

Draft the six copy fields. JSON only.`;

  const text = await callClaude({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    model: DEFAULT_MODEL,
    maxTokens: 1200,
  });

  const parsed = extractJson<Record<string, unknown>>(text);

  return {
    artworkId: artwork.id,
    suggestions: {
      title: clip(parsed.title, 60),
      description: clipText(parsed.description, 1200),
      productType,
      price: defaults?.price ?? artwork.price ?? null,
      editionSize,
      currency: defaults?.currency ?? artwork.currency ?? null,
      seoTitle: clip(parsed.seoTitle, 60),
      seoDescription: clip(parsed.seoDescription, 160),
      ogTitle: clip(parsed.ogTitle, 60),
      ogDescription: clip(parsed.ogDescription, 200),
    },
  };
}

/**
 * Suggest the print size: keep the operator's explicit choice when set,
 * otherwise derive the largest size the image can reach after the
 * standard upscale step (same logic pushToGelatoAction applies later, so
 * the suggestion matches what the push would auto-pick).
 */
async function suggestProductType(
  current: string | null,
  imageUrl: string | null
): Promise<string | null> {
  if (current) return current;
  if (!imageUrl) return null;
  try {
    const dims = await fetchImageDimensions(imageUrl);
    if (!dims?.width || !dims?.height) return null;
    return planUpscaleForBase(dims.width, dims.height).productType;
  } catch {
    return null;
  }
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

/** Like clip but preserves internal blank lines (paragraph breaks). */
function clipText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}
