/**
 * Default retail prices + edition sizes per product type.
 *
 * Used by:
 *   - artwork-form (prefills the Price + Edition Size fields when the
 *     operator picks a product_type)
 *   - createArtworkAction (server-side fallback when the form fields
 *     are still empty at submit time)
 *
 * Pricing rationale (in EUR, museum-quality matte poster):
 *   The retail floor is roughly 3× Gelato cost — covers Stripe + VAT
 *   + a margin we can discount from. Numbers are rounded to memorable
 *   tens. Adjust here when costs shift; both surfaces pick up the new
 *   table on next render.
 *
 * Edition sizing:
 *   Default 50 — small enough to feel limited, large enough to make
 *   the maths work at our price point. Operator can override per-piece
 *   or set to null in the form for an open edition.
 */

export interface ProductDefaults {
  price: number;
  currency: 'EUR';
  editionSize: number;
  /** Printed size in centimetres. */
  widthCm: number;
  heightCm: number;
  /**
   * Base Gelato production cost for one unit (EUR, VAT-excl estimate).
   * Mirrors sql/032_pricing.sql seed + lib/pricing.ts FALLBACK_ROWS so the
   * form's margin preview matches the /pricing editor. Kept in sync
   * manually; the actual per-order cost is stamped on the order at sync.
   */
  gelatoCostEur: number;
}

export const PRODUCT_DEFAULTS: Record<string, ProductDefaults> = {
  'museum-poster-21x30': { price: 49, currency: 'EUR', editionSize: 50, widthCm: 21, heightCm: 30, gelatoCostEur: 14 },
  'museum-poster-30x30': { price: 49, currency: 'EUR', editionSize: 50, widthCm: 30, heightCm: 30, gelatoCostEur: 15 },
  'museum-poster-30x40': { price: 69, currency: 'EUR', editionSize: 50, widthCm: 30, heightCm: 40, gelatoCostEur: 19 },
  'museum-poster-30x45': { price: 79, currency: 'EUR', editionSize: 50, widthCm: 30, heightCm: 45, gelatoCostEur: 20 },
  'museum-poster-40x50': { price: 89, currency: 'EUR', editionSize: 40, widthCm: 40, heightCm: 50, gelatoCostEur: 26 },
  'museum-poster-50x50': { price: 79, currency: 'EUR', editionSize: 40, widthCm: 50, heightCm: 50, gelatoCostEur: 30 },
  'museum-poster-50x70': { price: 119, currency: 'EUR', editionSize: 30, widthCm: 50, heightCm: 70, gelatoCostEur: 38 },
  'museum-poster-60x90': { price: 159, currency: 'EUR', editionSize: 25, widthCm: 60, heightCm: 90, gelatoCostEur: 54 },
  'museum-poster-70x100': { price: 199, currency: 'EUR', editionSize: 20, widthCm: 70, heightCm: 100, gelatoCostEur: 70 },
};

export function getProductDefaults(productType: string | null | undefined): ProductDefaults | null {
  if (!productType) return null;
  return PRODUCT_DEFAULTS[productType] ?? null;
}

/**
 * Gelato prints matte posters at 300 DPI. This derives the master-file
 * pixel floor a chosen size needs to print sharp, so the form can warn
 * when the source art is too small (current Gemini output is ~1024 px on
 * the long side — anything above 21×30 cm needs an upscaler step first).
 *   px = cm / 2.54 in × 300 dpi
 */
export const PRINT_DPI = 300;
const CM_PER_INCH = 2.54;

export interface PrintSpec {
  widthCm: number;
  heightCm: number;
  /** Minimum master-file pixels to print this size at PRINT_DPI. */
  minPxWidth: number;
  minPxHeight: number;
}

export function getPrintSpec(productType: string | null | undefined): PrintSpec | null {
  const d = getProductDefaults(productType);
  if (!d) return null;
  return {
    widthCm: d.widthCm,
    heightCm: d.heightCm,
    minPxWidth: Math.round((d.widthCm / CM_PER_INCH) * PRINT_DPI),
    minPxHeight: Math.round((d.heightCm / CM_PER_INCH) * PRINT_DPI),
  };
}
