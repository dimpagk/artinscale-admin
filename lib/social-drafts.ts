import { supabaseAdmin } from '@/lib/supabase/admin';
import { BRAND_LOGO_URL, type SlideConfig, type VisualConfig } from '@/lib/constants/content';

/**
 * One-click social drafts from an artwork's mockup set.
 *
 * Composes a carousel (feed) or story (9:16) draft into `social_posts`
 * so the operator reviews it in the Content studio and exports/schedules
 * through the existing pipeline. Nothing here publishes.
 *
 * Composition rules (operator-set, 2026-07):
 *   - Image order mirrors the ad-carousel standard: framed first, then
 *     room, then the zoom crops. The plain original is used ONLY as a
 *     substitute when a zoom crop is missing, never as its own slide.
 *   - Text never sits on top of the artwork images. All text lives on
 *     dedicated slides / blocks rendered by the Content studio canvas,
 *     which applies the brand tokens (Outfit / DM Sans, brand palette),
 *     so every word is fully branded by construction.
 */

interface MockupUrls {
  framed?: string;
  inRoom?: string;
  details?: string[];
  original?: string;
}

export interface SocialDraftArtwork {
  id: string;
  title: string;
  price: number | null;
  currency: string | null;
  product_type: string | null;
  shopify_handle: string | null;
  creation_source: string | null;
  mockup_urls: MockupUrls | null;
  artistName: string | null;
}

export type SocialDraftKind = 'carousel' | 'story';

export interface SocialDraftResult {
  ok: boolean;
  postId?: string;
  message: string;
}

/** "museum-poster-50x70" -> "50x70 cm" (empty string when unknown). */
function sizeText(productType: string | null): string {
  const m = productType?.match(/(\d+)x(\d+)/);
  return m ? `${m[1]}x${m[2]} cm` : '';
}

/**
 * The ordered image list for slides: framed, room, zoom 1, zoom 2. The
 * original substitutes a missing zoom (the "extra zoom" rule) but is
 * otherwise left out.
 */
function orderedImages(m: MockupUrls): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  if (m.framed) out.push({ label: 'Framed', url: m.framed });
  if (m.inRoom) out.push({ label: 'Room', url: m.inRoom });
  const zooms = (m.details ?? []).filter(Boolean).slice(0, 2);
  zooms.forEach((url, i) => out.push({ label: `Zoom ${i + 1}`, url }));
  if (zooms.length < 2 && m.original) {
    out.push({ label: `Zoom ${zooms.length + 1}`, url: m.original });
  }
  return out;
}

/** A clean image-only slide: full-bleed, no overlay text, no padding. */
function imageSlide(url: string, alt: string): SlideConfig {
  return {
    bg: 'galleryWhite',
    dark: false,
    accent: 'none',
    footer: '',
    format: 'portrait',
    blocks: [{ type: 'screenshot', url, alt, border: false, fullBleed: true }],
  };
}

/**
 * The closing slide: the "wall label" (operator-picked direction,
 * 2026-07). A museum placard: logo top-left, whitespace above like a
 * gallery wall, text block anchored to the bottom by a fill spacer, and
 * a quiet underlined link instead of a button. Brand rules: no price on
 * artwork posts (price lives on the PDP), no accent banner, no footer
 * (the link carries the domain).
 */
function ctaSlide(a: SocialDraftArtwork): SlideConfig {
  const size = sizeText(a.product_type);
  const craftLine = [
    a.artistName ? `By ${a.artistName}.` : null,
    `Archival matte print${size ? `, ${size}` : ''}. Made to order.`,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    bg: 'galleryWhite',
    dark: false,
    accent: 'none',
    footer: '',
    format: 'portrait',
    blocks: [
      { type: 'logo', url: BRAND_LOGO_URL, height: 24, align: 'left' },
      { type: 'spacer', fill: true },
      { type: 'tag', text: 'EXCLUSIVELY AT ARTINSCALE' },
      { type: 'headline', text: a.title, fontSize: 'lg' },
      { type: 'text', text: craftLine },
      { type: 'spacer', height: 12 },
      {
        type: 'priceDisplay',
        price: '',
        cta: 'Shop at artinscale.com',
        shopifyHandle: a.shopify_handle ?? '',
        variant: 'link',
      },
    ],
  };
}

/**
 * Default caption. Brand rule (operator, 2026-07): customer-facing copy
 * never mentions AI or machine provenance; the Meta paid-ads disclosure
 * is a form toggle, not copy.
 */
function caption(a: SocialDraftArtwork): string {
  const size = sizeText(a.product_type);
  const lines = [
    `"${a.title}"${a.artistName ? ` by ${a.artistName}` : ''}.`,
    `Archival matte print${size ? `, ${size}` : ''}. Made to order.`,
  ];
  if (a.shopify_handle) {
    lines.push('', `artinscale.com/product/${a.shopify_handle}`);
  }
  return lines.join('\n');
}

/**
 * Build the visual_config + insert the draft row. Returns the new post id.
 */
export async function createSocialDraft(
  artwork: SocialDraftArtwork,
  kind: SocialDraftKind
): Promise<SocialDraftResult> {
  const mockups = artwork.mockup_urls ?? {};
  const images = orderedImages(mockups);

  if (images.length === 0) {
    return {
      ok: false,
      message: 'No mockup set yet. Generate mockups first, then create social drafts.',
    };
  }

  let postType: string;
  let visualConfig: VisualConfig;

  if (kind === 'carousel') {
    const slides = [
      ...images.map((img) => imageSlide(img.url, `${artwork.title} (${img.label})`)),
      ctaSlide(artwork),
    ];
    postType = 'carousel';
    visualConfig = { ...slides[0], slides };
  } else {
    // Story: one 9:16 slide. Framed image (the canonical lead) with the
    // branded text blocks above/below it, never painted over the art.
    const hero = images[0];
    const size = sizeText(artwork.product_type);
    postType = 'single';
    visualConfig = {
      bg: 'galleryWhite',
      dark: false,
      accent: 'topBar',
      footer: 'artinscale.com',
      format: 'story',
      blocks: [
        { type: 'tag', text: size ? `ARCHIVAL MATTE PRINT · ${size}` : 'ARCHIVAL MATTE PRINT' },
        { type: 'headline', text: artwork.title, fontSize: 'md' },
        { type: 'screenshot', url: hero.url, alt: `${artwork.title} (${hero.label})`, border: false },
        {
          type: 'priceDisplay',
          price: '',
          cta: 'Shop at artinscale.com',
          shopifyHandle: artwork.shopify_handle ?? '',
        },
      ],
    };
  }

  const { data, error } = await supabaseAdmin
    .from('social_posts')
    .insert({
      title: `${artwork.title} (${kind})`,
      platform: 'instagram',
      post_type: postType,
      visual_config: visualConfig,
      caption: caption(artwork),
      status: 'draft',
      artwork_id: artwork.id,
      tags: ['source:artwork-page', `kind:${kind}`],
    })
    .select('id')
    .single();

  if (error) return { ok: false, message: `Draft insert failed: ${error.message}` };

  return {
    ok: true,
    postId: (data as { id: string }).id,
    message:
      kind === 'carousel'
        ? `Carousel draft created (${images.length} image slides + branded CTA slide).`
        : 'Story draft created.',
  };
}
