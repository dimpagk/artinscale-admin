/**
 * Per-destination Gelato landed-cost lookup.
 *
 * Gelato prices production AND shipping in destination-country tiers, so
 * the cost to fulfil the same print swings widely by ship-to country
 * (~€15.8 landed to Germany vs ~€20.7 to Greece vs ~€23.7 to Italy on the
 * €29 hero). The order-level cost model only learns this post-sale from
 * the Gelato receipt; this module exposes it BEFORE the sale so the ads
 * side can set per-market CAC caps.
 *
 * Data source is a committed snapshot (`gelato-costs.json`), imported at
 * build time — no live Gelato call in the hot path. Regenerate it with:
 *
 *   node scripts/gelato-country-costs.mjs --write
 *
 * Contribution EXCLUDES VAT (see docs/GEOGRAPHY_ECONOMICS.md for the VAT
 * nuance). Currency is EUR.
 */

import rawSnapshot from './gelato-costs.json';

export type CountryTier = 'A' | 'B';

/** One (size × destination) landed-cost cell from the snapshot. */
export interface GelatoLandedCost {
  /** Gelato destination production price (EUR). */
  production: number;
  /** Cheapest Gelato shipment method to this country (EUR). */
  shipping: number;
  /** production + shipping (EUR). */
  landed: number;
  /** Modelled payment fee at this size's retail price (EUR). */
  paymentFee: number;
  /**
   * retail − landed − paymentFee (EUR, pre-VAT). This is the allowable-CAC
   * ceiling: spend more than this to acquire the order and it loses money.
   */
  contribution: number;
  /** contribution as a % of retail. */
  marginPct: number;
  /** Cheapest method's delivery window, e.g. "8-15" days. */
  deliveryDays: string;
  /** ISO country where Gelato produces this order (informational). */
  madeIn: string | null;
}

interface SizeSnapshot {
  label: string;
  retail: number;
  markets: Record<string, GelatoLandedCost>;
}

interface Snapshot {
  generatedAt: string;
  source: string;
  currency: string;
  paymentFee: { percent: number; fixed: number };
  note: string;
  sizes: Record<string, SizeSnapshot>;
}

const snapshot = rawSnapshot as unknown as Snapshot;

/**
 * Default fraction of contribution to target as the CAC cap, leaving the
 * remainder as profit. 0.6 → aim to acquire for ≤60% of contribution.
 */
export const DEFAULT_TARGET_CAC_RATIO = 0.6;

/**
 * Hero-size contribution (EUR) at or above which a market is cheap-tier.
 * Data-driven classification so it survives a Gelato reprice.
 */
const TIER_A_MIN_HERO_CONTRIBUTION = 10;
const HERO_SIZE_KEY = 'museum-poster-21x30';

function normalizeCountry(country: string): string {
  return country.trim().toUpperCase();
}

/** ISO country when the snapshot was generated. */
export function snapshotGeneratedAt(): string {
  return snapshot.generatedAt;
}

/** True when the snapshot is older than `maxDays` (default 90). */
export function isSnapshotStale(maxDays = 90): boolean {
  const ageMs = Date.now() - new Date(snapshot.generatedAt).getTime();
  return ageMs > maxDays * 24 * 60 * 60 * 1000;
}

/** Countries covered by the snapshot (ISO alpha-2). */
export function supportedMarkets(): string[] {
  const size = snapshot.sizes[HERO_SIZE_KEY];
  return size ? Object.keys(size.markets) : [];
}

/**
 * Landed cost + contribution for a size shipped to `country`, or null if
 * the size or country is not in the snapshot. `sizeKey` is the canonical
 * GelatoSizeKey (e.g. 'museum-poster-21x30').
 */
export function getGelatoLandedCost(
  sizeKey: string,
  country: string
): GelatoLandedCost | null {
  return snapshot.sizes[sizeKey]?.markets[normalizeCountry(country)] ?? null;
}

/**
 * CAC cap (EUR) for a size in a market: (snapshot) contribution × targetRatio.
 *
 * NOTE: this uses the snapshot's contribution, which is PRE-VAT and at the
 * snapshot's own (classics) retail price. For live prices AND output VAT
 * netted down (matching order_economics), use `contributionFor` /
 * `getCatalogBidCaps` in ./bid-caps — that is the source of truth for
 * campaign caps. Kept here only as the raw per-size×country primitive.
 */
export function getAllowableCac(
  sizeKey: string,
  country: string,
  targetRatio: number = DEFAULT_TARGET_CAC_RATIO
): number | null {
  const cell = getGelatoLandedCost(sizeKey, country);
  if (!cell) return null;
  return Math.round(cell.contribution * targetRatio * 100) / 100;
}

/**
 * Cheap-tier ('A') vs expensive-tier ('B') classification for a market,
 * based on hero-size contribution. Null when the country isn't covered.
 */
export function getCountryTier(country: string): CountryTier | null {
  const cell = getGelatoLandedCost(HERO_SIZE_KEY, country);
  if (!cell) return null;
  return cell.contribution >= TIER_A_MIN_HERO_CONTRIBUTION ? 'A' : 'B';
}

export interface LandedRange {
  cheapest: { country: string; landed: number };
  dearest: { country: string; landed: number };
}

/**
 * Cheapest and dearest destination landed cost (production + shipping, EUR)
 * for a size across the covered markets. Null if the size isn't in the
 * snapshot. This is the real per-country cost spread the blended
 * `print_size_pricing` estimate hides.
 */
export function getLandedRange(sizeKey: string): LandedRange | null {
  const markets = supportedMarkets()
    .map((country) => ({ country, landed: getGelatoLandedCost(sizeKey, country)?.landed }))
    .filter((m): m is { country: string; landed: number } => m.landed != null)
    .sort((a, b) => a.landed - b.landed);
  if (!markets.length) return null;
  return { cheapest: markets[0], dearest: markets[markets.length - 1] };
}
