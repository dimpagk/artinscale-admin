/**
 * Gelato product configuration — Museum-Quality Matte Paper Poster only
 * for Phase 1 launch.
 *
 * Phase 1 update (2026-05-09): the original design used Gelato dashboard
 * templates (operator-configured `templateUid`s). We've switched to the
 * **Gelato Product Catalog API** instead — every `productUid` here is a
 * real, discovered SKU from `https://product.gelatoapis.com/v3/catalogs/posters`,
 * filtered to PaperType=200-gsm-uncoated (Museum-Quality Matte) and
 * Orientation=ver (portrait).
 *
 * No dashboard setup required. The catalog API is fully programmatic
 * and these UIDs are stable across Gelato accounts. To rediscover or
 * extend the catalog, run:
 *
 *   curl -H "X-API-KEY: $GELATO_API_KEY" \
 *     -X POST https://product.gelatoapis.com/v3/catalogs/posters/products:search \
 *     -H 'Content-Type: application/json' \
 *     -d '{"attributeFilters":{"PaperType":["200-gsm-uncoated"],"Orientation":["ver"]},"limit":100}'
 *
 * Reference: https://docs.gelato.com/reference/get-catalog-products
 *
 * ─────────────────────────────────────────────────────────────────────
 * SIZE STRATEGY (Museum-Quality Matte Paper Poster, all portrait)
 *
 * Sizes are deliberately limited to 7 options that map cleanly onto
 * room contexts. Skipping landscape orientation for v1 — every launch
 * piece is composed portrait so we don't need to maintain two
 * compositions per artwork.
 *
 * | Size      | Aspect | Best for                           |
 * |-----------|--------|------------------------------------|
 * | 21×30 cm  | 7:10   | Hallway gallery / desk / stairs    |
 * | 30×40 cm  | 3:4    | Bedroom flank / office desk above  |
 * | 30×45 cm  | 2:3    | Office focal / corridor end-cap    |
 * | 40×50 cm  | 4:5    | Office statement / dining single   |
 * | 50×70 cm  | 5:7    | Above-bed single / above-chair     |
 * | 60×90 cm  | 2:3    | Above 200 cm sofa pair / dining    |
 * | 70×100 cm | 7:10   | Above 220 cm sofa single statement |
 *
 * Interior-design rules baked into the room recommendations below:
 *   - Above-furniture art width ≈ 2/3 to 3/4 of the furniture
 *   - Eye-level center 145–155 cm from the floor
 *   - Bottom edge 15–25 cm above sofa back / headboard
 *   - Gallery walls: 5–10 cm spacing between pieces
 *
 * PRINT-SAFETY
 *
 * Min image px is computed at 150 DPI — Gelato's accepted floor for
 * matte poster. 300 DPI is recommended; current Gemini outputs are
 * ~1024 px on the long side, which means anything above 21×30 cm needs
 * an upscaler step (Real-ESRGAN via Replicate or equivalent) before it
 * is print-safe.
 * ─────────────────────────────────────────────────────────────────────
 */

const DPI_FLOOR = 150;
const CM_PER_INCH = 2.54;

/**
 * Common Gelato eCommerce-API productUid suffix matching the operator's
 * existing live products (verified 2026-05-09 against the live store):
 *   - Paper: 250 gsm uncoated offwhite archival ("Museum-Quality" archival)
 *   - Color: 4-0
 *   - Orientation: vertical (portrait)
 *
 * NOTE: this is the **unified-format** productUid (combined metric +
 * imperial size, `100lb` weight tag) used by Gelato's eCommerce API
 * (`POST /v1/stores/{id}/products`). It differs from the structured
 * format returned by the Catalog API (`flat_product_pf_X_pt_Y_…`).
 * Both refer to the same SKU; the eCommerce API expects this one.
 */
const MUSEUM_ARCHIVAL_SUFFIX = '250-gsm-100lb-uncoated-offwhite-archival_4-0_ver';

function museumMatteUid(paperFormat: string): string {
  return `flat_${paperFormat}_${MUSEUM_ARCHIVAL_SUFFIX}`;
}

function pxAtDpi(cm: number, dpi = DPI_FLOOR): number {
  return Math.ceil((cm / CM_PER_INCH) * dpi);
}

export type RoomType = 'office' | 'bedroom' | 'living-room' | 'dining-room' | 'hallway';

export interface GelatoTemplateConfig {
  /**
   * Gelato Catalog product UID — the SKU we send when fetching catalog
   * info or as a fallback when no template is configured. Stable
   * across Gelato accounts.
   */
  productUid: string;
  /**
   * Gelato eCommerce-API template UID — created in the dashboard,
   * referenced as `templateId` in `POST /v1/stores/{storeId}/products`.
   * This is the documented programmatic-creation path (the catalog
   * `productUid` alone is insufficient — Gelato silently drops variants
   * without a template).
   */
  templateUid: string | null;
  /** Human-readable label for this product type — surfaced in admin UI */
  label: string;
  /** Gelato product family. Phase 1 = `museum-matte-poster` only. */
  productFamily: 'museum-matte-poster';
  /** Physical width in cm */
  widthCm: number;
  /** Physical height in cm */
  heightCm: number;
  /** Aspect-ratio shorthand for compositions/UI */
  aspectRatio: string;
  /**
   * Minimum acceptable image dimensions in px for print-safe output at
   * 150 DPI. Computed from the size — do not edit by hand.
   */
  minImageWidthPx: number;
  minImageHeightPx: number;
  /** Recommended image dimensions at 300 DPI (Gelato preferred). */
  recommendedImageWidthPx: number;
  recommendedImageHeightPx: number;
  /** Rooms this size is recommended for (drives the room-mockup chooser) */
  recommendedRooms: RoomType[];
  /** One-line ergonomics blurb for the admin product-type dropdown */
  positioningBlurb: string;
  /**
   * If true, this size is in the launch SKU envelope. Phase 1 starts
   * with 21×30 only (no upscaler dependency); enable more as the
   * upscale step lands.
   */
  enabledForLaunch: boolean;
}

function makeMatteTemplate(args: {
  paperFormat: string;
  templateUid: string;
  widthCm: number;
  heightCm: number;
  aspectRatio: string;
  recommendedRooms: RoomType[];
  positioningBlurb: string;
  enabledForLaunch?: boolean;
}): GelatoTemplateConfig {
  return {
    productUid: museumMatteUid(args.paperFormat),
    templateUid: args.templateUid,
    label: `Museum-Quality Matte Poster · ${args.widthCm}×${args.heightCm} cm`,
    productFamily: 'museum-matte-poster',
    widthCm: args.widthCm,
    heightCm: args.heightCm,
    aspectRatio: args.aspectRatio,
    minImageWidthPx: pxAtDpi(args.widthCm, 150),
    minImageHeightPx: pxAtDpi(args.heightCm, 150),
    recommendedImageWidthPx: pxAtDpi(args.widthCm, 300),
    recommendedImageHeightPx: pxAtDpi(args.heightCm, 300),
    recommendedRooms: args.recommendedRooms,
    positioningBlurb: args.positioningBlurb,
    enabledForLaunch: args.enabledForLaunch ?? false,
  };
}

export const GELATO_TEMPLATES: Record<string, GelatoTemplateConfig> = {
  // Note: Gelato's archival paper doesn't carry a 21×30 cm SKU. A4 is
  // 210×297 mm (3 mm shorter than 30 cm) — functionally identical
  // hanging proportions. Marketing label keeps "21×30 cm" rounded.
  'museum-poster-21x30': makeMatteTemplate({
    paperFormat: 'a4-8x12-inch',
    templateUid: '07296bb6-304c-47db-8c38-f94445954270',
    widthCm: 21,
    heightCm: 30,
    aspectRatio: '7:10',
    recommendedRooms: ['hallway', 'office'],
    positioningBlurb:
      'Gallery-wall sizing (A4 / 21×30 cm) — best as a series of 3–5 down a hallway or a trio above a desk.',
    // Only Gemini-native size that's print-safe at 150 DPI without
    // upscaling. Safe to launch with this one first.
    enabledForLaunch: true,
  }),

  'museum-poster-30x40': makeMatteTemplate({
    paperFormat: '300x400-mm-12x16-inch',
    templateUid: 'b1d870ea-1d24-43bd-b57e-d7b98924be96',
    widthCm: 30,
    heightCm: 40,
    aspectRatio: '3:4',
    recommendedRooms: ['bedroom', 'office', 'hallway'],
    positioningBlurb:
      'Workhorse size. A pair flanking a bed or a console table; or single above a desk.',
  }),

  'museum-poster-30x45': makeMatteTemplate({
    paperFormat: '300x450-mm-12x18-inch',
    templateUid: '3500d49c-47ef-429e-a0a2-4a1b7c72780c',
    widthCm: 30,
    heightCm: 45,
    aspectRatio: '2:3',
    recommendedRooms: ['office', 'hallway'],
    positioningBlurb:
      'Slightly taller version of 30×40 — adds drama at corridor end-caps and reading nooks.',
  }),

  'museum-poster-40x50': makeMatteTemplate({
    paperFormat: '400x500-mm-16x20-inch',
    templateUid: 'fe4c42d0-3a9b-4a02-8483-5fde5beeed4e',
    widthCm: 40,
    heightCm: 50,
    aspectRatio: '4:5',
    recommendedRooms: ['office', 'dining-room', 'bedroom'],
    positioningBlurb:
      'Single-statement focal — works alone above a desk, dining sideboard, or low dresser.',
  }),

  'museum-poster-50x70': makeMatteTemplate({
    paperFormat: '500x700-mm-20x28-inch',
    templateUid: 'c03ddd1d-fd24-4e52-ad1e-67c272f5bfdf',
    widthCm: 50,
    heightCm: 70,
    aspectRatio: '5:7',
    recommendedRooms: ['bedroom', 'living-room', 'dining-room'],
    positioningBlurb:
      'Above-bed centerpiece for a queen, or pair behind a 4-seat dining table.',
  }),

  'museum-poster-60x90': makeMatteTemplate({
    paperFormat: '600x900-mm-24x36-inch',
    templateUid: 'ddf691be-4ba8-467d-aea3-3ee3a78b6b36',
    widthCm: 60,
    heightCm: 90,
    aspectRatio: '2:3',
    recommendedRooms: ['living-room', 'dining-room'],
    positioningBlurb:
      'Pair above a 200 cm sofa, or single behind a 6-seat dining table.',
  }),

  'museum-poster-70x100': makeMatteTemplate({
    paperFormat: '700x1000-mm-28x40-inch',
    templateUid: '7f53f6f5-078d-4e58-81fb-f2e74b22020b',
    widthCm: 70,
    heightCm: 100,
    aspectRatio: '7:10',
    recommendedRooms: ['living-room'],
    positioningBlurb:
      'Statement piece above a 220 cm sofa or in a wide entryway. Eye-level center 145–155 cm.',
  }),
};

export type GelatoTemplateKey = keyof typeof GELATO_TEMPLATES;

/**
 * Room-first lookup — given a room, returns sizes recommended for it.
 * Used by the per-artwork mockup composer to pick the right scene.
 */
export function getSizesForRoom(room: RoomType): GelatoTemplateKey[] {
  return Object.entries(GELATO_TEMPLATES)
    .filter(([, cfg]) => cfg.recommendedRooms.includes(room))
    .map(([key]) => key as GelatoTemplateKey);
}

/**
 * Reverse lookup — given a size, returns the rooms it best fits.
 * Used by the admin product-type picker to suggest contexts.
 */
export function getRoomsForSize(productType: string): RoomType[] {
  return GELATO_TEMPLATES[productType]?.recommendedRooms ?? [];
}

/**
 * Legacy helper retained for callers that still ask whether a template
 * UID is a placeholder. With the catalog-based flow, every config has
 * a real `productUid` so this always returns `false`. Kept for one
 * release to avoid call-site churn.
 */
export function isPlaceholderTemplate(templateUid: string | null): boolean {
  if (!templateUid) return false;
  return templateUid.startsWith('<TODO_REPLACE_WITH_REAL_UID>');
}

export function getTemplateConfig(productType: string): GelatoTemplateConfig | null {
  return GELATO_TEMPLATES[productType] ?? null;
}

/**
 * Gelato's recommended DPI for museum-quality fine-art posters. Their
 * accepted floor is 150 DPI, but the museum-matte product line is
 * explicitly documented as "at least 300 DPI" for good quality, so we
 * size to 300. See lib/product-copy sizing + pushToGelatoAction.
 */
export const QUALITY_DPI = 300;

/** Smallest template — the safe fallback when nothing else qualifies. */
export const SMALLEST_TEMPLATE: GelatoTemplateKey = 'museum-poster-21x30';

/**
 * Given a finalized image's pixel dimensions, return the LARGEST template
 * whose physical size still prints at >= `dpi` in both axes — i.e. the
 * biggest print we can sell at good quality for this image. Every piece
 * gets exactly one size, and it's the maximum the resolution supports.
 *
 * All templates are portrait, so callers should pass portrait-oriented
 * px (width <= height). The check is per-axis and conservative; it
 * assumes the image aspect roughly matches the template's (our
 * generations are composed portrait). Returns null when the image is too
 * small for even the smallest size at `dpi`.
 */
/**
 * The image width (px) needed to print the LARGEST template at `dpi` —
 * i.e. render a resolution-independent source (vector SVG) at least this
 * wide and `pickLargestPrintSize` can reach the top size (70×100 →
 * 8268px @ 300 DPI). Portrait, so this is the shorter physical side.
 */
export function maxPrintWidthPx(dpi: number = QUALITY_DPI): number {
  return Math.max(
    ...Object.values(GELATO_TEMPLATES).map((cfg) => pxAtDpi(cfg.widthCm, dpi))
  );
}

export function pickLargestPrintSize(
  imageWidthPx: number,
  imageHeightPx: number,
  dpi: number = QUALITY_DPI
): GelatoTemplateKey | null {
  const bySizeDesc = (
    Object.entries(GELATO_TEMPLATES) as [GelatoTemplateKey, GelatoTemplateConfig][]
  ).sort((a, b) => b[1].widthCm * b[1].heightCm - a[1].widthCm * a[1].heightCm);

  for (const [key, cfg] of bySizeDesc) {
    if (imageWidthPx >= pxAtDpi(cfg.widthCm, dpi) && imageHeightPx >= pxAtDpi(cfg.heightCm, dpi)) {
      return key;
    }
  }
  return null;
}

/**
 * Faithful upscale ceiling. Beyond this, upscaling invents too much to
 * still call the result "museum quality". A real 4K Gemini base
 * (~3584×4800) reaches 70×100 within ~2.5x, so 3x is enough headroom to
 * unlock every size without over-reaching.
 */
export const MAX_UPSCALE_FACTOR = 3;

/**
 * Largest size we auto-target. Capped at 50×70: reachable from a 4K base
 * with Real-ESRGAN x2 (most faithful, cheapest), and the sweet-spot hero
 * size. Raise to 'museum-poster-70x100' to let Clarity push every piece
 * bigger; operators can still pin a larger size per piece.
 */
export const MAX_AUTO_PRINT_SIZE: GelatoTemplateKey = 'museum-poster-50x70';

export interface UpscalePlan {
  /** The single size this piece will be sold at. */
  productType: GelatoTemplateKey;
  /** Upscale ratio needed to hit QUALITY_DPI for that size (1 = none). */
  factor: number;
  /** Which upscaler to use — null when the base already prints at size. */
  model: 'real-esrgan' | 'clarity' | null;
  /** Scale passed to the upscaler (2 for Real-ESRGAN, exact for Clarity). */
  scale: number;
  targetWidthPx: number;
  targetHeightPx: number;
}

function areaCm(key: GelatoTemplateKey): number {
  const c = GELATO_TEMPLATES[key];
  return c.widthCm * c.heightCm;
}

function buildPlan(
  key: GelatoTemplateKey,
  needW: number,
  needH: number,
  factor: number
): UpscalePlan {
  // Tiny tolerance so a base that's essentially at-size isn't upscaled.
  if (factor <= 1.02) {
    return { productType: key, factor: 1, model: null, scale: 1, targetWidthPx: needW, targetHeightPx: needH };
  }
  // Up to 2x: Real-ESRGAN x2 — cheap, fast, faithful. It overshoots
  // slightly (fine: higher DPI), and the binding axis keeps the size correct.
  if (factor <= 2) {
    return { productType: key, factor, model: 'real-esrgan', scale: 2, targetWidthPx: needW, targetHeightPx: needH };
  }
  // Bigger jumps (60×90, 70×100): Clarity at the exact factor — tiles to
  // reach the needed megapixels without the integer-only / cap limits of
  // Real-ESRGAN. Round up to a tenth, clamp to the faithful ceiling.
  const scale = Math.min(MAX_UPSCALE_FACTOR, Math.ceil(factor * 10) / 10);
  return { productType: key, factor, model: 'clarity', scale, targetWidthPx: needW, targetHeightPx: needH };
}

/**
 * Given a base image's pixels, pick the largest print size reachable at
 * QUALITY_DPI within MAX_UPSCALE_FACTOR (never above MAX_AUTO_PRINT_SIZE)
 * and the plan to upscale to it. This is the single source of truth that
 * ties "how big can we print this" to "how much do we upscale".
 */
export function planUpscaleForBase(baseWidthPx: number, baseHeightPx: number): UpscalePlan {
  const cap = areaCm(MAX_AUTO_PRINT_SIZE);
  const candidates = (
    Object.entries(GELATO_TEMPLATES) as [GelatoTemplateKey, GelatoTemplateConfig][]
  )
    .filter(([k]) => areaCm(k) <= cap)
    .sort((a, b) => b[1].widthCm * b[1].heightCm - a[1].widthCm * a[1].heightCm);

  for (const [key, cfg] of candidates) {
    const needW = pxAtDpi(cfg.widthCm, QUALITY_DPI);
    const needH = pxAtDpi(cfg.heightCm, QUALITY_DPI);
    const factor = Math.max(needW / baseWidthPx, needH / baseHeightPx);
    if (factor <= MAX_UPSCALE_FACTOR) {
      return buildPlan(key, needW, needH, factor);
    }
  }

  // Base too small for even the smallest size within the ceiling — target
  // the smallest and upscale as far as the ceiling allows (print-safety
  // still gates the actual push).
  const cfg = GELATO_TEMPLATES[SMALLEST_TEMPLATE];
  const needW = pxAtDpi(cfg.widthCm, QUALITY_DPI);
  const needH = pxAtDpi(cfg.heightCm, QUALITY_DPI);
  const factor = Math.min(MAX_UPSCALE_FACTOR, Math.max(needW / baseWidthPx, needH / baseHeightPx));
  return buildPlan(SMALLEST_TEMPLATE, needW, needH, factor);
}

export function isLaunchEnabled(productType: string): boolean {
  return GELATO_TEMPLATES[productType]?.enabledForLaunch ?? false;
}

export function listLaunchEnabledProductTypes(): string[] {
  return Object.entries(GELATO_TEMPLATES)
    .filter(([, cfg]) => cfg.enabledForLaunch)
    .map(([key]) => key);
}

/**
 * Inverse of `recommendedRooms` for the room-mockup chooser. Each room
 * gets a default "hero" size — the one to render the in-room mockup at
 * if the operator hasn't pinned one explicitly.
 */
export const ROOM_HERO_SIZE: Record<RoomType, GelatoTemplateKey> = {
  office: 'museum-poster-40x50',
  bedroom: 'museum-poster-50x70',
  'living-room': 'museum-poster-70x100',
  'dining-room': 'museum-poster-50x70',
  hallway: 'museum-poster-30x40',
};
