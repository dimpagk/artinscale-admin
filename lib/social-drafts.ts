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
  inspiration_summary: string | null;
  description: string | null;
}

export type SocialDraftKind = 'carousel' | 'story' | 'ad';

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

/** A clean image-only slide: full-bleed, no overlay text, no padding.
 * Square: carousel cards render 1:1, so the crop is baked in here. */
function imageSlide(url: string, alt: string): SlideConfig {
  return {
    bg: 'galleryWhite',
    dark: false,
    accent: 'none',
    footer: '',
    format: 'square',
    blocks: [{ type: 'screenshot', url, alt, border: false, fullBleed: true }],
  };
}

/**
 * One-line provenance/story text for the story card: the inspiration
 * summary when present, else the first sentence or two of the
 * description, capped so it stays a caption, not a paragraph.
 */
function storyLine(a: SocialDraftArtwork): string | null {
  const src = (a.inspiration_summary || a.description || '').trim();
  if (!src) return null;
  const sentences = src.split(/(?<=[.!?])\s+/);
  let out = sentences[0] ?? '';
  if (out.length < 70 && sentences[1]) out = `${out} ${sentences[1]}`;
  if (out.length > 150) out = out.slice(0, 147).trimEnd() + '...';
  // inspiration_summary is stored as a lowercase fragment; present it as
  // a sentence.
  out = out.charAt(0).toUpperCase() + out.slice(1);
  if (!/[.!?]$/.test(out)) out += '.';
  return out;
}

/**
 * One ad-kit slide (operator direction, 2026-07): the paid-ads template.
 * Same composition at every format so the three exports read as one
 * campaign: brand mark top-centre, the framed print floating on gallery
 * white, and the wall label (tag, title, craft line) beneath it. All
 * type renders through the branded canvas blocks (Outfit / DM Sans,
 * real logo asset) - never text baked into the artwork. No price on
 * the image; price lives in the ad's primary text and on the PDP.
 */
function adKitSlide(
  a: SocialDraftArtwork,
  format: 'square' | 'portrait' | 'story',
  imageUrl: string
): SlideConfig {
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
    format,
    blocks: [
      { type: 'logo', url: BRAND_LOGO_URL, height: 26, align: 'center' },
      { type: 'spacer', fill: true },
      { type: 'screenshot', url: imageUrl, alt: `${a.title} (framed)`, border: false, fit: 'contain' },
      { type: 'spacer', fill: true },
      { type: 'tag', text: 'EXCLUSIVELY AT ARTINSCALE' },
      { type: 'headline', text: a.title, fontSize: 'xl', weight: 700, tracking: -0.7 },
      { type: 'text', text: craftLine },
    ],
  };
}

/**
 * The opening story card (operator direction, 2026-07): the artwork
 * itself full-bleed, a bottom scrim, and the story anchored low in
 * white: artist eyebrow, title, one provenance line. The hook slide;
 * the product slides follow. Uses the original art (this card is about
 * the work, not the print); falls back to the framed shot.
 */
function storyCardSlide(a: SocialDraftArtwork): SlideConfig | null {
  const m = a.mockup_urls ?? {};
  const url = m.original || m.framed;
  if (!url) return null;
  const story = storyLine(a);
  return {
    bg: 'galleryWhite',
    dark: false,
    accent: 'none',
    footer: '',
    format: 'square',
    blocks: [
      { type: 'screenshot', url, alt: `${a.title} (artwork)`, border: false, fullBleed: true },
      ...(a.artistName ? [{ type: 'tag' as const, text: `BY ${a.artistName}` }] : []),
      { type: 'headline', text: a.title, fontSize: 'xl', weight: 700, tracking: -0.7 },
      ...(story ? [{ type: 'text' as const, text: story }] : []),
    ],
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
    format: 'square',
    blocks: [
      { type: 'logo', url: BRAND_LOGO_URL, height: 24, align: 'left' },
      { type: 'spacer', fill: true },
      { type: 'tag', text: 'EXCLUSIVELY AT ARTINSCALE' },
      { type: 'headline', text: a.title, fontSize: 'xl', weight: 700, tracking: -0.7 },
      // No CTA link: links are not tappable in feed images; the operator
      // carries the link in the caption (and the story link sticker).
      { type: 'text', text: craftLine },
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

  if (kind === 'ad') {
    // Ad kit: one post whose three slides are the three ad placements
    // (feed 1:1, feed 4:5, story 9:16). Stored as a carousel so the
    // grid's Export & Upload renders every slide - the exported PNGs
    // land in placement order, ready to attach in Ads Manager. The
    // framed mockup is the hero (it sells scale); falls back to the
    // original art if the framed composite is missing.
    const hero = mockups.framed || mockups.original;
    if (!hero) {
      return {
        ok: false,
        message: 'No framed mockup or original image. Generate mockups first.',
      };
    }
    const slides = [
      adKitSlide(artwork, 'square', hero),
      adKitSlide(artwork, 'portrait', hero),
      adKitSlide(artwork, 'story', hero),
    ];
    postType = 'carousel';
    visualConfig = { ...slides[0], slides };
  } else if (kind === 'carousel') {
    const story = storyCardSlide(artwork);
    const slides = [
      ...(story ? [story] : []),
      ...images.map((img) => imageSlide(img.url, `${artwork.title} (${img.label})`)),
      ctaSlide(artwork),
    ];
    postType = 'carousel';
    visualConfig = { ...slides[0], slides };
  } else {
    // Story: one 9:16 slide combining the carousel's first and last
    // slides (operator direction, 2026-07): the framed hero hangs in the
    // upper half (fit contain so the whole frame shows), and the wall
    // label sits bottom-anchored beneath it, exactly like the carousel's
    // closing slide. No banner, no footer, no price, link CTA.
    const hero = images[0];
    const size = sizeText(artwork.product_type);
    const craftLine = [
      artwork.artistName ? `By ${artwork.artistName}.` : null,
      `Archival matte print${size ? `, ${size}` : ''}. Made to order.`,
    ]
      .filter(Boolean)
      .join(' ');
    postType = 'single';
    // Full-bleed treatment (operator direction): the framed hero covers
    // the whole 9:16 canvas as the background (first block, fullBleed),
    // and the wording overlays it bottom-anchored on the renderer's dark
    // scrim (white text). No CTA link: the operator adds IG's link
    // sticker at publish time.
    visualConfig = {
      bg: 'galleryWhite',
      dark: false,
      accent: 'none',
      footer: '',
      format: 'story',
      blocks: [
        { type: 'screenshot', url: hero.url, alt: `${artwork.title} (${hero.label})`, border: false, fullBleed: true },
        { type: 'logo', url: BRAND_LOGO_URL, height: 22, align: 'left' },
        { type: 'tag', text: 'EXCLUSIVELY AT ARTINSCALE' },
        { type: 'headline', text: artwork.title, fontSize: 'xl', weight: 700, tracking: -0.7 },
        { type: 'text', text: craftLine },
      ],
    };
  }

  const { data, error } = await supabaseAdmin
    .from('social_posts')
    .insert({
      title: `${artwork.title} (${kind === 'ad' ? 'ad kit' : kind})`,
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
      kind === 'ad'
        ? 'Ad kit draft created (1:1, 4:5 and 9:16 slides). Export & Upload renders the three placement PNGs.'
        : kind === 'carousel'
          ? `Carousel draft created (story card + ${images.length} image slides + branded CTA slide).`
          : 'Story draft created.',
  };
}
