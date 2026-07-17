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
 *   netRev       = price ÷ (1 + outputVat(country)/100)   // price is VAT-inclusive
 *   contribution = netRev − landedCost(size, country) − paymentFee(price)
 *   cap          = contribution × targetRatio   (default 0.6; keep ~40% profit)
 *
 * Contribution is NET of output VAT, matching the order_economics view. We
 * ARE Greek VAT-registered (finance_settings.default_vat_percent = 24). Under
 * the €10k pan-EU distance-selling threshold that home rate applies to every
 * EU B2C sale; non-EU exports (US) are zero-rated (UK is a special case, see
 * outputVatPercent). Gelato input VAT is tracked as a separate cost in
 * order_economics and, matching it, is NOT subtracted here. See
 * docs/GEOGRAPHY_ECONOMICS.md.
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

/**
 * Fallback home VAT rate (%) when a caller doesn't pass one. Mirrors
 * finance_settings.default_vat_percent (Greek standard rate). Callers that
 * can reach the DB should pass the live value.
 */
export const DEFAULT_HOME_VAT_PERCENT = 24;

/** EU-27 member states (ISO alpha-2) — B2C sales here carry output VAT. */
const EU_MEMBERS = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
]);

/**
 * Non-EU markets that still require charging local VAT on B2C (not a clean
 * zero-rated export). UK: consignments ≤ £135 need UK VAT registration +
 * 20% at point of sale, so we model it like a VAT market, not an export.
 */
const NON_EU_OUTPUT_VAT: Record<string, number> = { GB: 20 };

/**
 * Output VAT % to apply on a B2C sale shipped to `country`, given the
 * seller's home rate. EU → home rate (24 under the <€10k regime; swap for
 * destination rates once on OSS); listed non-EU exceptions (UK 20); all
 * other non-EU (US, CH, …) → 0, zero-rated export.
 */
export function outputVatPercent(
  country: string,
  homeVatPercent: number = DEFAULT_HOME_VAT_PERCENT
): number {
  const c = country.trim().toUpperCase();
  if (EU_MEMBERS.has(c)) return homeVatPercent;
  return NON_EU_OUTPUT_VAT[c] ?? 0;
}

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

/**
 * Contribution for `sizeKey` sold at gross (VAT-inclusive) `price`, shipped
 * to `country`, NET of output VAT and the community artist royalty so it
 * matches order_economics:
 *   netRev  = price ÷ (1 + vatPercent/100)
 *   royalty = price × royaltyPercent/100        (on gross line revenue, as in
 *                                                order_artist_royalty; 0 for
 *                                                non-community pieces)
 *   contribution = netRev − landed − paymentFee − royalty
 * `vatPercent` is the OUTPUT VAT for that country (use `outputVatPercent`).
 */
export function contributionFor(
  sizeKey: string,
  country: string,
  price: number,
  vatPercent: number = DEFAULT_HOME_VAT_PERCENT,
  royaltyPercent: number = 0
): number | null {
  const cell = getGelatoLandedCost(sizeKey, country);
  if (!cell) return null;
  const netRev = price / (1 + vatPercent / 100);
  const royalty = round2((price * royaltyPercent) / 100);
  return round2(netRev - cell.landed - paymentFee(price) - royalty);
}

/** One listed catalog piece: what it is and what it sells for. */
export interface CatalogPiece {
  sizeKey: string;
  price: number;
  /** Units sold to date — reserved for future sales-weighting. */
  unitsSold?: number;
  /** Per-sale community artist royalty % (0 / omitted for non-community). */
  royaltyPercent?: number;
}

export interface MarketCap {
  country: string;
  name: string;
  tier: CountryTier | null;
  /** Output VAT % applied to sales in this market (0 for zero-rated exports). */
  vatPercent: number;
  /** Mean per-order contribution across the listed pieces, net of VAT (EUR). */
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
  opts: { targetRatio?: number; weighted?: boolean; homeVatPercent?: number } = {}
): MarketCap[] {
  const {
    targetRatio = DEFAULT_TARGET_CAC_RATIO,
    weighted = false,
    homeVatPercent = DEFAULT_HOME_VAT_PERCENT,
  } = opts;
  if (!pieces.length) return [];
  const deliverySize = mostCommonSize(pieces);
  const rows: MarketCap[] = [];
  for (const country of supportedMarkets()) {
    const vatPercent = outputVatPercent(country, homeVatPercent);
    let weightedSum = 0;
    let weightTotal = 0;
    let n = 0;
    for (const p of pieces) {
      const c = contributionFor(p.sizeKey, country, p.price, vatPercent, p.royaltyPercent ?? 0);
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
      vatPercent,
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
  targetRatio: number = DEFAULT_TARGET_CAC_RATIO,
  homeVatPercent: number = DEFAULT_HOME_VAT_PERCENT
): SizeCapRow[] {
  const out: SizeCapRow[] = [];
  for (const s of sizes) {
    const perMarket = supportedMarkets()
      .map((country) => ({
        country,
        contribution: contributionFor(
          s.sizeKey,
          country,
          s.price,
          outputVatPercent(country, homeVatPercent)
        ),
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

/** A market cap joined with its actual spend / orders / CAC in the window. */
export interface MarketPerfRow extends MarketCap {
  spend: number | null;
  metaOrders: number | null;
  /** Meta spend ÷ Meta-attributed purchases. */
  metaCac: number | null;
  metaRoas: number | null;
  shopifyOrders: number | null;
  /** Meta spend ÷ all Shopify orders to the country (blended). */
  blendedCac: number | null;
  verdict: 'under' | 'watch' | 'over' | 'no-orders' | 'no-data';
}

interface CountryActualsLike {
  spend: number;
  metaOrders: number;
  metaRevenue: number;
  shopifyOrders: number;
}

/**
 * Join the allowable-CAC caps with per-country actuals into display rows.
 * Verdict compares the primary actual CAC (Meta-attributed, else blended)
 * against the cap: under / watch (≤15% over) / over. `no-orders` = spend but
 * no conversions; `no-data` = no spend recorded yet.
 */
export function buildMarketPerformance(
  caps: MarketCap[],
  byCountry: Record<string, CountryActualsLike>
): MarketPerfRow[] {
  return caps.map((cap) => {
    const a = byCountry[cap.country];
    const spend = a && a.spend > 0 ? round2(a.spend) : null;
    const metaOrders = a ? a.metaOrders : null;
    const shopifyOrders = a ? a.shopifyOrders : null;
    const metaCac = spend != null && metaOrders ? round2(spend / metaOrders) : null;
    const blendedCac = spend != null && shopifyOrders ? round2(spend / shopifyOrders) : null;
    const metaRoas = spend != null && a && a.metaRevenue ? round2(a.metaRevenue / spend) : null;

    const primary = metaCac ?? blendedCac;
    let verdict: MarketPerfRow['verdict'];
    if (spend == null) verdict = 'no-data';
    else if (primary == null) verdict = 'no-orders';
    else if (primary <= cap.cap) verdict = 'under';
    else if (primary <= cap.cap * 1.15) verdict = 'watch';
    else verdict = 'over';

    return {
      ...cap,
      spend,
      metaOrders,
      metaCac,
      metaRoas,
      shopifyOrders,
      blendedCac,
      verdict,
    };
  });
}

export function bidCapsGeneratedAt(): string {
  return snapshotGeneratedAt();
}
