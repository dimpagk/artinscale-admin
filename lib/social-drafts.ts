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

/** The shared "By {artist}. Archival matte print, {size}. Made to order." line. */
function craftLineFor(a: SocialDraftArtwork): string {
  const size = sizeText(a.product_type);
  return [
    a.artistName ? `By ${a.artistName}.` : null,
    `Archival matte print${size ? `, ${size}` : ''}. Made to order.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The shared ad/story slide (operator direction, 2026-07-20): the
 * SINGLE source of truth for every ad placement and the "Generate
 * story" button, so all of them are identical by construction. The
 * artwork covers the whole canvas full-bleed ("the art is the
 * background"); the renderer lays a bottom scrim and anchors the
 * wording low, flush left in white - logo, tag, title, craft line.
 * No baked-in text over the art beyond that overlay, no price on the
 * image (price lives in the ad's primary text and on the PDP), no
 * footer (IG's link sticker / the ad CTA carries the link).
 */
/**
 * Headline size adapts to title length so long titles don't crowd the
 * scrim overlay (xl on a square wraps past two lines around ~26 chars;
 * every extra line eats into the artwork). Short titles keep the
 * approved xl look; longer ones step down instead of wrapping deep.
 * The 9:16 canvas is taller, so its thresholds are looser.
 */
function headlineSizeFor(title: string, format: 'square' | 'portrait' | 'story'): 'md' | 'lg' | 'xl' {
  const n = title.length;
  if (format === 'story') return n <= 34 ? 'xl' : n <= 52 ? 'lg' : 'md';
  return n <= 26 ? 'xl' : n <= 42 ? 'lg' : 'md';
}

function storySlide(
  a: SocialDraftArtwork,
  heroUrl: string,
  heroLabel: string,
  format: 'square' | 'portrait' | 'story' = 'story'
): SlideConfig {
  return {
    bg: 'galleryWhite',
    dark: false,
    accent: 'none',
    footer: '',
    format,
    blocks: [
      { type: 'screenshot', url: heroUrl, alt: `${a.title} (${heroLabel})`, border: false, fullBleed: true },
      { type: 'logo', url: BRAND_LOGO_URL, height: 22, align: 'left' },
      { type: 'tag', text: 'EXCLUSIVELY AT ARTINSCALE' },
      { type: 'headline', text: a.title, fontSize: headlineSizeFor(a.title, format), weight: 700, tracking: -0.7 },
      { type: 'text', text: craftLineFor(a) },
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
    // Ad kit: one post per creative variant, each with the three ad
    // placements (feed 1:1, feed 4:5, story 9:16) as slides sharing the
    // storySlide treatment - hero full-bleed, scrim, flush-left overlay.
    // Stored as carousels so the grid's Export & Upload renders every
    // slide; the exported PNGs land in placement order, ready to attach
    // in Ads Manager.
    //   Variant A "framed": the framed print on a wall (the approved
    //     control look). Falls back to the original art if no composite.
    //   Variant B "room": the in-room lifestyle mockup - same template,
    //     different hero - so Meta can A/B context-vs-closeup. Skipped
    //     when the artwork has no in-room composite.
    const framedHero = mockups.framed || mockups.original;
    if (!framedHero) {
      return {
        ok: false,
        message: 'No framed mockup or original image. Generate mockups first.',
      };
    }
    const variants: Array<{ key: string; hero: string; label: string; suffix: string }> = [
      {
        key: 'framed',
        hero: framedHero,
        label: mockups.framed ? 'Framed' : 'Original',
        suffix: '',
      },
      ...(mockups.inRoom
        ? [{ key: 'room', hero: mockups.inRoom, label: 'Room', suffix: ' - room' }]
        : []),
    ];
    const created: string[] = [];
    for (const v of variants) {
      const slides = [
        storySlide(artwork, v.hero, v.label, 'square'),
        storySlide(artwork, v.hero, v.label, 'portrait'),
        storySlide(artwork, v.hero, v.label, 'story'),
      ];
      const { data, error } = await supabaseAdmin
        .from('social_posts')
        .insert({
          title: `${artwork.title} (ad kit${v.suffix})`,
          platform: 'instagram',
          post_type: 'carousel',
          visual_config: { ...slides[0], slides },
          caption: caption(artwork),
          status: 'draft',
          artwork_id: artwork.id,
          tags: ['source:artwork-page', 'kind:ad', `variant:${v.key}`],
        })
        .select('id')
        .single();
      if (error) return { ok: false, message: `Draft insert failed: ${error.message}` };
      created.push((data as { id: string }).id);
    }
    return {
      ok: true,
      postId: created[0],
      message:
        created.length === 2
          ? 'Ad kit drafts created: framed + room variants, three placements each. Export & Upload each post for the A/B set.'
          : 'Ad kit draft created (framed variant only - no in-room mockup for a room variant).',
    };
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
    // Story: one 9:16 full-bleed slide, built by the shared storySlide()
    // so the organic story and the ad kit's story placement stay in
    // lockstep. The operator adds IG's link sticker at publish time.
    const hero = images[0];
    postType = 'single';
    visualConfig = storySlide(artwork, hero.url, hero.label);
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
        ? `Carousel draft created (story card + ${images.length} image slides + branded CTA slide).`
        : 'Story draft created.',
  };
}
