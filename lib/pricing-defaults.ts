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
}

export const PRODUCT_DEFAULTS: Record<string, ProductDefaults> = {
  'museum-poster-21x30': { price: 49, currency: 'EUR', editionSize: 50 },
  'museum-poster-30x40': { price: 69, currency: 'EUR', editionSize: 50 },
  'museum-poster-30x45': { price: 79, currency: 'EUR', editionSize: 50 },
  'museum-poster-40x50': { price: 89, currency: 'EUR', editionSize: 40 },
  'museum-poster-50x70': { price: 119, currency: 'EUR', editionSize: 30 },
  'museum-poster-60x90': { price: 159, currency: 'EUR', editionSize: 25 },
  'museum-poster-70x100': { price: 199, currency: 'EUR', editionSize: 20 },
};

export function getProductDefaults(productType: string | null | undefined): ProductDefaults | null {
  if (!productType) return null;
  return PRODUCT_DEFAULTS[productType] ?? null;
}
