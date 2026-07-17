/**
 * Per-market ad bid caps, grounded in the LISTED catalog at LIVE prices.
 *
 * Retail pricing is flat across countries, but Gelato's landed cost is
 * destination-tiered (see docs/GEOGRAPHY_ECONOMICS.md), so the acquisition
 * budget per order differs by market even at one price. This module turns
 * that into the cost cap (max CPA) to enter on each market's Meta ad set.
 *
 * Two things are decoupled on purpose:
 *   - Landed COST per (size × country) is the slow-moving Gelato part — it
 *     lives in the committed snapshot (gelato-costs.json).
 *   - PRICE is volatile and operator-editable — it is passed in live from
 *     `print_size_pricing` / the listed artworks, never frozen here.
 * So a price edit on the Pricing page moves the caps immediately.
 *
 * Caps are grounded in what is actually for sale: the caps that matter are
 * averaged over the LISTED catalog pieces, each at its real size and price
 * (today the catalog is 40×50 and 50×70 — no 21×30 is listed). The average
 * is unweighted for now; pass `unitsSold` and set `weighted: true` to weight
 * by sales per item once that is wanted.
 *
 *   contribution = price − landedCost(size, country) − paymentFee(price)
 *   cap          = contribution × targetRatio   (default 0.6; keep ~40% profit)
 *
 * Contribution excludes VAT (roughly constant % drag; we are not VAT-
 * registered yet). See docs/GEOGRAPHY_ECONOMICS.md.
 */

import {
  getGelatoLandedCost,
  getCountryTier,
  supportedMarkets,
  snapshotGeneratedAt,
  DEFAULT_TARGET_CAC_RATIO,
  type CountryTier,
} from './gelato-landed-cost';

export const PAYMENT_FEE_PCT = 0.019;
export const PAYMENT_FEE_FIXED = 0.25;

const round2 = (n: number) => Math.round(n * 100) / 100;

const MARKET_NAMES: Record<string, string> = {
  US: 'USA',
  GB: 'UK',
  SE: 'Sweden',
  DE: 'Germany',
  BE: 'Belgium',
  FR: 'France',
  GR: 'Greece',
  PL: 'Poland',
  PT: 'Portugal',
  ES: 'Spain',
  NL: 'Netherlands',
  AT: 'Austria',
  IE: 'Ireland',
  IT: 'Italy',
};

/** Shopify-style payment fee on a sale (EUR). */
export function paymentFee(price: number): number {
  return round2(price * PAYMENT_FEE_PCT + PAYMENT_FEE_FIXED);
}

/** Pre-VAT contribution for `sizeKey` sold at `price`, shipped to `country`. */
export function contributionFor(
  sizeKey: string,
  country: string,
  price: number
): number | null {
  const cell = getGelatoLandedCost(sizeKey, country);
  if (!cell) return null;
  return round2(price - cell.landed - paymentFee(price));
}

/** One listed catalog piece: what it is and what it sells for. */
export interface CatalogPiece {
  sizeKey: string;
  price: number;
  /** Units sold to date — reserved for future sales-weighting. */
  unitsSold?: number;
}

export interface MarketCap {
  country: string;
  name: string;
  tier: CountryTier | null;
  /** Mean per-order contribution across the listed pieces (EUR). */
  avgContribution: number;
  /** avgContribution × targetRatio — the cost cap to enter in Meta (EUR). */
  cap: number;
  deliveryDays: string;
  /** How many listed pieces the average is over. */
  pieces: number;
  guidance: string;
}

function guidanceForTier(tier: CountryTier | null): string {
  if (tier === 'A') return 'Cheap to fulfil — bid up to the cap.';
  if (tier === 'B') return 'Expensive to fulfil — cap tight; lead larger formats.';
  return '';
}

function mostCommonSize(pieces: CatalogPiece[]): string {
  const counts: Record<string, number> = {};
  for (const p of pieces) counts[p.sizeKey] = (counts[p.sizeKey] ?? 0) + 1;
  return (
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    'museum-poster-50x70'
  );
}

/**
 * Allowable CAC per market, averaged over the listed catalog pieces (each at
 * its real size + live price). Unweighted today; set `weighted: true` (with
 * `unitsSold` on each piece) to weight by sales per item.
 */
export function getCatalogBidCaps(
  pieces: CatalogPiece[],
  opts: { targetRatio?: number; weighted?: boolean } = {}
): MarketCap[] {
  const { targetRatio = DEFAULT_TARGET_CAC_RATIO, weighted = false } = opts;
  if (!pieces.length) return [];
  const deliverySize = mostCommonSize(pieces);
  const rows: MarketCap[] = [];
  for (const country of supportedMarkets()) {
    let weightedSum = 0;
    let weightTotal = 0;
    let n = 0;
    for (const p of pieces) {
      const c = contributionFor(p.sizeKey, country, p.price);
      if (c == null) continue;
      // +1 smoothing so unsold pieces still count once when weighted.
      const w = weighted ? (p.unitsSold ?? 0) + 1 : 1;
      weightedSum += c * w;
      weightTotal += w;
      n++;
    }
    if (!n) continue;
    const avg = round2(weightedSum / weightTotal);
    const tier = getCountryTier(country);
    rows.push({
      country,
      name: MARKET_NAMES[country] ?? country,
      tier,
      avgContribution: avg,
      cap: round2(avg * targetRatio),
      deliveryDays: getGelatoLandedCost(deliverySize, country)?.deliveryDays ?? '',
      pieces: n,
      guidance: guidanceForTier(tier),
    });
  }
  return rows.sort((a, b) => b.cap - a.cap);
}

/** A size with its current live price, for the per-size reference table. */
export interface PricedSize {
  sizeKey: string;
  label: string;
  price: number;
}

export interface SizeCapRow {
  sizeKey: string;
  label: string;
  price: number;
  landedCheapest: number;
  landedDearest: number;
  capCheapest: number;
  capDearest: number;
  cheapestCountry: string;
  dearestCountry: string;
}

/**
 * Price-aware per-size reference: the cheapest and dearest market cap for
 * each priced size. Reads live prices, so it doubles as a cross-check that
 * the caps track current pricing.
 */
export function getSizeCapReference(
  sizes: PricedSize[],
  targetRatio: number = DEFAULT_TARGET_CAC_RATIO
): SizeCapRow[] {
  const out: SizeCapRow[] = [];
  for (const s of sizes) {
    const perMarket = supportedMarkets()
      .map((country) => ({
        country,
        contribution: contributionFor(s.sizeKey, country, s.price),
        landed: getGelatoLandedCost(s.sizeKey, country)?.landed,
      }))
      .filter(
        (m): m is { country: string; contribution: number; landed: number } =>
          m.contribution != null && m.landed != null
      )
      .sort((a, b) => b.contribution - a.contribution); // best headroom first
    if (!perMarket.length) continue;
    const best = perMarket[0];
    const worst = perMarket[perMarket.length - 1];
    out.push({
      sizeKey: s.sizeKey,
      label: s.label,
      price: s.price,
      landedCheapest: round2(best.landed),
      landedDearest: round2(worst.landed),
      capCheapest: round2(best.contribution * targetRatio),
      capDearest: round2(worst.contribution * targetRatio),
      cheapestCountry: best.country,
      dearestCountry: worst.country,
    });
  }
  return out;
}

export function bidCapsGeneratedAt(): string {
  return snapshotGeneratedAt();
}
