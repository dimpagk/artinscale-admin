/**
 * Per-market ad bid caps, grounded in the LISTED catalog at LIVE prices.
 *
 * Retail pricing is flat across countries, but Gelato's landed cost is
 * destination-tiered (see docs/GEOGRAPHY_ECONOMICS.md), so the acquisition
 * budget per order differs by market even at one price. This module turns
 * that into the cost cap (max CPA) to enter on each market's Meta ad set.
 *
 * Two things are decoupled on purpose:
 *   - Landed COST per (size × country) is the slow-moving Gelato part; it
 *     lives in the committed snapshot (gelato-costs.json).
 *   - PRICE is volatile and operator-editable; it is passed in live from
 *     `print_size_pricing` / the listed artworks, never frozen here.
 * So a price edit on the Pricing page moves the caps immediately.
 *
 * Caps are grounded in what is actually for sale: the caps that matter are
 * averaged over the LISTED catalog pieces, each at its real size and price
 * (today the catalog is 40×50 and 50×70; no 21×30 is listed). The average
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

/** EU-27 member states (ISO alpha-2): B2C sales here carry output VAT. */
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
  /** Units sold to date, reserved for future sales-weighting. */
  unitsSold?: number;
  /** Per-sale community artist royalty % (0 / omitted for non-community). */
  royaltyPercent?: number;
  /** One-time creation/acquisition cost (EUR), used by the per-€1 summary. */
  creationCost?: number;
}

export interface MarketCap {
  country: string;
  name: string;
  tier: CountryTier | null;
  /** Output VAT % applied to sales in this market (0 for zero-rated exports). */
  vatPercent: number;
  /** Mean per-order contribution across the listed pieces, net of VAT (EUR). */
  avgContribution: number;
  /** avgContribution × targetRatio: the cost cap to enter in Meta (EUR). */
  cap: number;
  deliveryDays: string;
  /** How many listed pieces the average is over. */
  pieces: number;
  guidance: string;
}

function guidanceForTier(tier: CountryTier | null): string {
  if (tier === 'A') return 'Cheap to fulfil: bid up to the cap.';
  if (tier === 'B') return 'Expensive to fulfil: cap tight; lead larger formats.';
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

/** Weight scheme shared by every catalog average: +1 smoothing so unsold
 * pieces still count once when sales-weighted. */
function pieceWeight(p: CatalogPiece, weighted: boolean): number {
  return weighted ? (p.unitsSold ?? 0) + 1 : 1;
}

interface MarketAverages {
  country: string;
  vatPercent: number;
  /** Weighted average gross (VAT-inclusive) price across pieces (EUR). */
  gross: number;
  /** Weighted average net (ex-VAT) revenue (EUR). */
  net: number;
  /** Weighted average contribution (EUR), unrounded. */
  contrib: number;
  /** Pieces included (snapshot-covered sizes only). */
  pieces: number;
}

/**
 * The single per-market reducer both the caps table and the per-euro summary
 * consume, so weighting, VAT, and piece coverage can never diverge between
 * them. Pieces whose size is missing from the landed-cost snapshot are
 * skipped consistently (they contribute to nothing).
 */
function marketWeightedAverages(
  pieces: CatalogPiece[],
  weighted: boolean,
  homeVatPercent: number
): MarketAverages[] {
  const rows: MarketAverages[] = [];
  for (const country of supportedMarkets()) {
    const vatPercent = outputVatPercent(country, homeVatPercent);
    let wsGross = 0;
    let wsNet = 0;
    let wsContrib = 0;
    let wt = 0;
    let n = 0;
    for (const p of pieces) {
      const c = contributionFor(p.sizeKey, country, p.price, vatPercent, p.royaltyPercent ?? 0);
      if (c == null) continue;
      const w = pieceWeight(p, weighted);
      wsGross += p.price * w;
      wsNet += (p.price / (1 + vatPercent / 100)) * w;
      wsContrib += c * w;
      wt += w;
      n++;
    }
    if (!wt) continue;
    rows.push({
      country,
      vatPercent,
      gross: wsGross / wt,
      net: wsNet / wt,
      contrib: wsContrib / wt,
      pieces: n,
    });
  }
  return rows;
}

/** Per-market cap with the same rounding the table displays. */
function capOf(contrib: number, targetRatio: number): number {
  return round2(round2(contrib) * targetRatio);
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
  const rows = marketWeightedAverages(pieces, weighted, homeVatPercent).map((m) => {
    const tier = getCountryTier(m.country);
    return {
      country: m.country,
      name: MARKET_NAMES[m.country] ?? m.country,
      tier,
      vatPercent: m.vatPercent,
      avgContribution: round2(m.contrib),
      cap: capOf(m.contrib, targetRatio),
      deliveryDays: getGelatoLandedCost(deliverySize, m.country)?.deliveryDays ?? '',
      pieces: m.pieces,
      guidance: guidanceForTier(tier),
    };
  });
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

/**
 * Blended "per €1" economics at the CAC caps: the four operator ratios
 * (target max CAC, ROAS at cap, revenue per €1 of total spend, EBITDA per
 * €1 of total spend). Blended = simple mean across the covered markets (the
 * real blend follows budget allocation; this is the neutral baseline), built
 * on the same marketWeightedAverages/capOf the caps table uses, so the tile
 * always equals the mean of the table's CAC-cap column.
 *
 * Two bases:
 *   - marginal ("sunk"): creation cost of existing pieces ignored.
 *   - loaded: blended creation cost amortised over `amortUnits` sales per
 *     piece, plus `opexPerOrder` (subscriptions ÷ orders; 0 until wired to
 *     recurring_costs).
 *
 * Total spend per order = (netRev − contribution) + CAC [+ creation + opex],
 * i.e. landed + payment fee + royalty + CAC, all pre-VAT cash out.
 *
 * Returns null when there is nothing meaningful to show: no pieces, no
 * covered markets, or blended contribution ≤ 0 (a below-cost price would
 * otherwise render Infinity/negative ratios; the per-market table still
 * exposes the negative caps so the problem stays visible).
 */
export interface PerEuroSummary {
  /** Mean of the per-market CAC caps (EUR), same rounding as the table. */
  blendedCap: number;
  /** Gross order value ÷ CAC at the blended cap (what Meta shows). */
  roas: number;
  /** Net (ex-VAT) revenue per €1 of total spend, marginal basis. */
  revenuePerEuro: number;
  /** ...loaded basis (creation amortised + opex). */
  revenuePerEuroLoaded: number;
  /** EBITDA per order at the cap (EUR), loaded basis. */
  ebitdaPerOrderLoaded: number;
  /** EBITDA per €1 of total spend, loaded basis (= revenuePerEuroLoaded − 1). */
  roiLoaded: number;
  /** Blended creation cost charged per order in the loaded basis (EUR). */
  creationPerOrder: number;
  amortUnits: number;
  opexPerOrder: number;
  markets: number;
}

export function getPerEuroSummary(
  pieces: CatalogPiece[],
  opts: {
    targetRatio?: number;
    weighted?: boolean;
    homeVatPercent?: number;
    /** Lifetime sales assumed per piece for creation amortisation. */
    amortUnits?: number;
    /** Flat opex allocation per order (subscriptions ÷ expected orders). */
    opexPerOrder?: number;
  } = {}
): PerEuroSummary | null {
  const {
    targetRatio = DEFAULT_TARGET_CAC_RATIO,
    weighted = false,
    homeVatPercent = DEFAULT_HOME_VAT_PERCENT,
    amortUnits = 10,
    opexPerOrder = 0,
  } = opts;
  if (!pieces.length) return null;

  const markets = marketWeightedAverages(pieces, weighted, homeVatPercent);
  if (!markets.length) return null;

  // Creation blend over the SAME universe as revenue: only snapshot-covered
  // pieces (a piece the market loop skips must not add creation cost either).
  const firstMarket = markets[0].country;
  const covered = pieces.filter(
    (p) => getGelatoLandedCost(p.sizeKey, firstMarket) != null
  );
  let ccSum = 0;
  let ccW = 0;
  for (const p of covered) {
    const w = pieceWeight(p, weighted);
    ccSum += (p.creationCost ?? 0) * w;
    ccW += w;
  }
  const creationPerOrder =
    amortUnits > 0 && ccW > 0 ? round2(ccSum / ccW / amortUnits) : 0;

  // Simple-mean blend across markets; caps rounded exactly as the table.
  const mkts = markets.length;
  const gross = markets.reduce((s, m) => s + m.gross, 0) / mkts;
  const net = markets.reduce((s, m) => s + m.net, 0) / mkts;
  const contrib = markets.reduce((s, m) => s + m.contrib, 0) / mkts;
  const cap = markets.reduce((s, m) => s + capOf(m.contrib, targetRatio), 0) / mkts;

  // Below-cost pricing makes the blended ratios meaningless; hide the tiles.
  if (cap <= 0) return null;

  // net − contribution = landed + payment fee + royalty (per-order cash cost).
  const variableCost = net - contrib;
  const totalMarginal = variableCost + cap + opexPerOrder;
  const totalLoaded = totalMarginal + creationPerOrder;
  if (totalMarginal <= 0) return null;

  const revenuePerEuro = round2(net / totalMarginal);
  const revenuePerEuroLoaded = round2(net / totalLoaded);

  return {
    blendedCap: round2(cap),
    roas: round2(gross / cap),
    revenuePerEuro,
    revenuePerEuroLoaded,
    ebitdaPerOrderLoaded: round2(contrib - cap - opexPerOrder - creationPerOrder),
    // Derived from the same rounded figure so adjacent tiles always reconcile.
    roiLoaded: round2(revenuePerEuroLoaded - 1),
    creationPerOrder,
    amortUnits,
    opexPerOrder,
    markets: mkts,
  };
}

export function bidCapsGeneratedAt(): string {
  return snapshotGeneratedAt();
}
