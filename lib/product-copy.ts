/**
 * Single source of truth for product copy that flows from
 *   admin → Gelato → Shopify → storefront
 *
 * Used by:
 *   - `pushToGelatoAction` to build the description/tags/variant title
 *     sent to Gelato (which propagates to Shopify product description)
 *   - Future: storefront SEO meta tags (currently they read Shopify's
 *     product description directly, so they inherit whatever this
 *     module writes — keeps SEO end-to-end consistent without duplicate
 *     templating).
 *
 * If you change the shape of `buildProductCopy()` output, also change
 * the storefront's product detail page rendering to match.
 */

import type { GelatoTemplateConfig } from './gelato-templates';

export interface ProductCopyInput {
  title: string;
  /** The artwork's per-piece narrative (operator-written or agent-drafted) */
  artworkSynopsis: string | null;
  /** Inspiration summary fallback — used when synopsis is empty */
  inspirationSummary: string | null;
  artistName: string;
  artistBio?: string | null;
  topicTitle: string | null;
  topicId: string | null;
  /** Resolved Gelato product config — provides size, paper, dimensions */
  productConfig: GelatoTemplateConfig | null;
  /** Optional: edition label like "1 of 50" or null for open. Currently
   *  not rendered in the description (the canonical Artinscale format
   *  doesn't include an edition line — Shopify variant inventory tracks
   *  it instead). Kept on the input for callers that may need it for
   *  other surfaces. */
  editionLabel?: string | null;
  /**
   * Style descriptor for the "Style:" line in the Artwork details
   * block — e.g. "Risograph, illustration", "Abstract, minimalist".
   *
   * Derived by callers from the artist's primary style pack (typically
   * style_packs.pack.persona.styleDescriptor or a hand-crafted short
   * label per persona). Omitted from the rendered description when
   * null — the format is otherwise unchanged so callers can pass null
   * during migration.
   */
  style?: string | null;
}

export interface ProductCopyOutput {
  /**
   * HTML description sent to Gelato (and onward to Shopify product
   * description). Three paragraphs:
   *   1. Artwork synopsis
   *   2. Collection/topic framing
   *   3. Structured artwork details (artist, collection, medium, dimensions)
   */
  description: string;
  /** Plain-text fallback (~160 chars) for SEO meta description */
  seoDescription: string;
  /** Array of tags applied to Gelato + Shopify */
  tags: string[];
  /** Variant title — `40x60 cm / 16x24″ - Vertical` */
  variantTitle: string;
  /** Suggested Shopify SEO title — `{Title} – {Artist} | Artinscale` */
  seoTitle: string;
}

export function buildProductCopy(input: ProductCopyInput): ProductCopyOutput {
  const cfg = input.productConfig;

  // ── Synopsis (fallback chain)
  // The terminal fallback stays neutral — claims about how a piece was
  // made (AI-rendered, community-inspired, etc.) belong in the per-piece
  // synopsis stored on the artwork, not in copy that runs for every
  // product including public-domain reproductions.
  const synopsis =
    input.artworkSynopsis?.trim() ||
    input.inspirationSummary?.trim() ||
    `${input.title} by ${input.artistName}.`;

  // ── Collection framing — only added when the piece is actually tied
  // to a topic. For unattached pieces (e.g. Classic Collection vintage
  // prints) we skip this paragraph entirely rather than inventing one.
  const collectionFraming = input.topicTitle
    ? `This artwork was created as part of the ${input.topicTitle} collection and reflects ${input.artistName}'s interpretation of the contributions submitted by the Artinscale community.`
    : null;

  // ── Structured details block
  // Format mirrors the operator's existing live products (e.g.
  // "Escaping Form", "First Bloom", "First Language"):
  //   Artist → Title → Collection → Medium → Style → Dimensions
  // Each line wraps in its own <span> ending with <br> except the
  // last, all enclosed in a single <p>. The "Artwork details:"
  // header is the first inner span. Edition is intentionally NOT
  // rendered — the canonical format leaves it to Shopify inventory.
  const dimensions = formatDimensions(cfg);
  const style = input.style?.trim() || null;

  const detailLines: Array<{ label: string; value: string } | { header: string }> = [
    { header: 'Artwork details:' },
    { label: 'Artist', value: input.artistName },
    { label: 'Title', value: input.title },
  ];
  if (input.topicTitle) detailLines.push({ label: 'Collection', value: input.topicTitle });
  detailLines.push({ label: 'Medium', value: 'Digital illustration' });
  if (style) detailLines.push({ label: 'Style', value: style });
  if (dimensions) detailLines.push({ label: 'Dimensions', value: dimensions });

  const detailsParagraph = (() => {
    const spans = detailLines.map((line, i) => {
      const isLast = i === detailLines.length - 1;
      const inner =
        'header' in line
          ? `<b>${escapeHtml(line.header)}</b>`
          : `${escapeHtml(line.label)}: ${escapeHtml(line.value)}`;
      return `<span>${inner}${isLast ? '' : '<br>'}</span>`;
    });
    return `<p>${spans.join('')}</p>`;
  })();

  const description = [
    `<p><span>${escapeHtml(synopsis)}</span></p>`,
    collectionFraming ? `<p><span>${escapeHtml(collectionFraming)}</span></p>` : null,
    detailsParagraph,
  ]
    .filter((s): s is string => s !== null)
    .join('');

  // ── SEO description: shortest single-sentence form, ≤160 chars
  const seoBase = input.topicTitle
    ? `${input.title} by ${input.artistName}: an archival matte print from Artinscale's ${input.topicTitle} collection.`
    : `${input.title} by ${input.artistName}: an archival matte print from Artinscale.`;
  const seoDescription = seoBase.length > 160 ? `${seoBase.slice(0, 157)}…` : seoBase;

  // ── SEO title: short, brand-anchored
  const seoTitle = `${input.title} – ${input.artistName} | Artinscale`;

  // ── Tags (these surface as Shopify product tags, used by storefront
  // collection filters + Meta product feed). Keep small + meaningful.
  // Tags reflect what's actually true about the piece, not aspiration:
  //   - 'museum-matte' / 'archival-print' only when the underlying
  //     Gelato product family is museum-matte-poster
  //   - 'limited-edition' only when there's an actual edition cap
  //     (editionLabel set and not the "Open edition" placeholder)
  const tags = ['illustration'];
  if (cfg?.productFamily === 'museum-matte-poster') {
    tags.push('museum-matte', 'archival-print');
  }
  const limited =
    !!input.editionLabel && input.editionLabel.trim().toLowerCase() !== 'open edition';
  if (limited) tags.push('limited-edition');
  if (input.topicId) tags.push(input.topicId);
  if (cfg) tags.push(`size-${cfg.widthCm}x${cfg.heightCm}`);

  // ── Variant title: matches the operator's existing live products'
  // format, e.g. "40x60 cm / 16x24″ - Vertical"
  const variantTitle = cfg ? defaultVariantTitle(cfg) : input.title;

  return {
    description,
    seoDescription,
    tags,
    variantTitle,
    seoTitle,
  };
}

/**
 * Print dimensions string — `40x60 cm / 16x24″` (metric / imperial).
 * Single source of truth shared by the description's "Dimensions:" line
 * and the storefront-facing `custom.dimensions` metafield. Returns an
 * empty string when there's no resolved size, so callers can skip the
 * line/metafield entirely.
 */
export function formatDimensions(cfg: GelatoTemplateConfig | null): string {
  if (!cfg) return '';
  const metric = `${cfg.widthCm}x${cfg.heightCm} cm`;
  const imperial = cmToInches(cfg.widthCm, cfg.heightCm);
  return `${metric} / ${imperial}″`;
}

/**
 * Print medium string for the `custom.medium` metafield, keyed off the
 * Gelato product family. Describes the physical print (paper, weight),
 * not the artwork medium: the description's "Medium: Digital
 * illustration" line covers that. Wording matches the storefront's
 * Print-details section. Empty string when there's no resolved config.
 */
export function formatMedium(cfg: GelatoTemplateConfig | null): string {
  if (!cfg) return '';
  const byFamily: Record<GelatoTemplateConfig['productFamily'], string> = {
    'museum-matte-poster': 'Natural matte print, 250 gsm archival paper',
  };
  return byFamily[cfg.productFamily] ?? '';
}

/**
 * Orientation for the `custom.orientation` metafield, lowercase so the
 * storefront can use it directly as a filter value.
 */
export function formatOrientation(cfg: GelatoTemplateConfig | null): string {
  if (!cfg) return '';
  if (cfg.widthCm === cfg.heightCm) return 'square';
  return cfg.heightCm > cfg.widthCm ? 'portrait' : 'landscape';
}

/**
 * `40x60 cm / 16x24″ - Vertical` style variant title — matches the
 * operator's existing live products. Exported for callers that need it
 * separately from the full copy bundle.
 */
export function defaultVariantTitle(cfg: GelatoTemplateConfig): string {
  const cm = `${cfg.widthCm}x${cfg.heightCm} cm`;
  const inches = cmToInches(cfg.widthCm, cfg.heightCm);
  const orient = cfg.heightCm >= cfg.widthCm ? 'Vertical' : 'Horizontal';
  return `${cm} / ${inches}″ - ${orient}`;
}

function cmToInches(widthCm: number, heightCm: number): string {
  // Whole inches, matching the operator's live products and the Gelato
  // variant titles (e.g. 50x70 cm → "20x28", 40x60 cm → "16x24",
  // 21x30 cm → "8x12"). Gelato's own SKUs use these rounded values, so
  // the storefront dimension must match to stay consistent.
  const w = Math.round(widthCm / 2.54);
  const h = Math.round(heightCm / 2.54);
  return `${w}x${h}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
