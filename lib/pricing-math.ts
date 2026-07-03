/**
 * Pure pricing math — no server imports, safe to use from Client
 * Components. lib/pricing.ts (server) re-exports these so both the
 * /pricing editor and the artwork form compute margin the same way.
 */

/**
 * Aggregate EUR sell prices of published artworks at one size — powers the
 * "recommended price" hint in the artwork form. Client-safe type; the query
 * that builds it (getPublishedPriceStatsBySize) lives in lib/pricing.ts.
 */
export interface SizePriceStat {
  /** How many published (listed/sold) EUR pieces at this size. */
  count: number;
  /** Median sell price — the recommendation. */
  median: number;
  min: number;
  max: number;
}

/**
 * One size's slice of the published catalog — powers the artwork form's
 * "size mix" breakdown so the operator can see how pieces (supply) and
 * units sold (demand) spread across sizes when choosing one. Client-safe
 * type; the query that builds it (getSizeMix) lives in lib/pricing.ts.
 */
export interface SizeMixEntry {
  sizeKey: string;
  /** Published (listed/sold) pieces at this size. */
  pieces: number;
  /** Total units sold across those pieces (sum of edition_sold). */
  unitsSold: number;
}

export interface PricingFinance {
  paymentFeePercent: number;
  paymentFeeFixed: number;
  /** VAT assumption used to strip VAT from the sell price for the margin
   *  preview. Not a real per-order figure — a modelling assumption. */
  vatPercent: number;
  source: 'defaults' | 'finance_settings';
}

// vatPercent here is the pricing FLOOR assumption: the worst-case VAT we
// might remit on a sale (Greek domestic standard rate, 24%). Pricing to
// this floor guarantees the margin on every sale — export / EU-B2B
// reverse-charge / small-business-exempt sales carry no VAT and earn more
// (the "ceiling", computed at 0% VAT). VAT is a pass-through, never our
// money; this only affects how much of the inclusive list price is ours.
export const GREEK_STANDARD_VAT = 24;

export const DEFAULT_FINANCE: PricingFinance = {
  paymentFeePercent: 2.9,
  paymentFeeFixed: 0.3,
  vatPercent: GREEK_STANDARD_VAT,
  source: 'defaults',
};

/**
 * Net contribution (EUR) on one sale after Gelato cost, payment fee, and
 * VAT (VAT excluded as pass-through). Returns null when we have no cost.
 *   net_rev = price / (1 + vat)
 *   fee     = price × fee% + fee_fixed
 *   profit  = net_rev − gelato − fee
 */
export function netContributionEur(
  priceEur: number,
  gelatoCost: number | null,
  fin: PricingFinance
): number | null {
  if (gelatoCost == null) return null;
  const netRev = priceEur / (1 + fin.vatPercent / 100);
  if (netRev <= 0) return null;
  const fee = priceEur * (fin.paymentFeePercent / 100) + fin.paymentFeeFixed;
  return netRev - gelatoCost - fee;
}

/**
 * Net margin % after Gelato cost, payment fee, and VAT (VAT excluded from
 * margin as pass-through). Returns null when we have no cost estimate.
 *   margin = (net_rev − gelato − fee) / net_rev
 */
export function netMarginPct(
  priceEur: number,
  gelatoCost: number | null,
  fin: PricingFinance
): number | null {
  if (gelatoCost == null) return null;
  const netRev = priceEur / (1 + fin.vatPercent / 100);
  if (netRev <= 0) return null;
  const profit = netContributionEur(priceEur, gelatoCost, fin);
  if (profit == null) return null;
  return (profit / netRev) * 100;
}
