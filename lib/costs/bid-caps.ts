/**
 * Per-market ad bid caps.
 *
 * Our retail pricing is FLAT across every country, but Gelato's landed cost
 * is destination-tiered (see docs/GEOGRAPHY_ECONOMICS.md). Same price minus a
 * higher cost = less contribution in expensive markets, so the acquisition
 * budget per order has to differ by market even though the price does not.
 *
 * This module turns the committed landed-cost snapshot into the number the
 * ads side actually needs: the **cost cap** (max CPA) to enter on each
 * market's Meta ad set. Nothing here calls Meta — it produces the caps an
 * operator pastes into Ads Manager, matching the rest of the marketing page.
 *
 * Two caps per market, because flat pricing leaves the lead FORMAT as the
 * lever, not the price:
 *   - heroCap  — cap for an ad set that prospects on the €29 hero (21×30).
 *   - largeCap — cap for an ad set that leads with the €79 50×70 format.
 * In expensive markets the hero cap is punishingly low; leading with a
 * larger format lifts the workable cap without touching the price.
 *
 * cap = contribution(size, country) × targetRatio   (default 0.6, i.e. keep
 * 40% of contribution as profit and spend at most 60% acquiring the order).
 */

import {
  getGelatoLandedCost,
  getCountryTier,
  supportedMarkets,
  snapshotGeneratedAt,
  DEFAULT_TARGET_CAC_RATIO,
  type CountryTier,
} from './gelato-landed-cost';

/** Prospecting hook (entry) and the recommended lead format for Tier B. */
export const HERO_SIZE_KEY = 'museum-poster-21x30';
export const LARGE_LEAD_SIZE_KEY = 'museum-poster-50x70';

// Hero-contribution guidance bands (EUR). Tier (A/B) comes from the helper;
// these sub-split Tier B into "thin but workable" vs "hero uneconomic".
const HERO_HEALTHY_MIN = 10;
const HERO_WORKABLE_MIN = 6;

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

export interface MarketBidCap {
  country: string;
  name: string;
  tier: CountryTier;
  /** Per-order contribution on the €29 hero (EUR, pre-VAT). */
  heroContribution: number;
  /** Cost cap for a hero-led ad set (EUR). */
  heroCap: number;
  /** Cost cap for a 50×70-led ad set (EUR). */
  largeCap: number;
  /** Cheapest-method delivery window to this market, e.g. "8-15" days. */
  deliveryDays: string;
  /** Short, flat-pricing-aware recommendation. */
  guidance: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function guidanceFor(heroContribution: number): string {
  if (heroContribution >= HERO_HEALTHY_MIN) {
    return 'Prospect on the €29 hero; bid up to the hero cap.';
  }
  if (heroContribution >= HERO_WORKABLE_MIN) {
    return 'Hero margin thin — bid tight, or lead 50×70+ to lift the cap.';
  }
  return 'Hero uneconomic — prospect on 50×70+ formats only.';
}

/**
 * Cost cap (EUR) for one market and lead size, or null if the size/country
 * is not in the snapshot. This is the raw number for programmatic use;
 * `getMarketBidCaps()` is the display-ready roll-up.
 */
export function getMarketBidCap(
  country: string,
  sizeKey: string = HERO_SIZE_KEY,
  targetRatio: number = DEFAULT_TARGET_CAC_RATIO
): number | null {
  const cell = getGelatoLandedCost(sizeKey, country);
  if (!cell) return null;
  return round2(cell.contribution * targetRatio);
}

/**
 * Bid caps for every market in the snapshot, sorted by hero cap (best
 * acquisition headroom first). `targetRatio` is the fraction of
 * contribution to spend acquiring an order (default 0.6).
 */
export function getMarketBidCaps(
  targetRatio: number = DEFAULT_TARGET_CAC_RATIO
): MarketBidCap[] {
  const rows: MarketBidCap[] = [];
  for (const country of supportedMarkets()) {
    const hero = getGelatoLandedCost(HERO_SIZE_KEY, country);
    const large = getGelatoLandedCost(LARGE_LEAD_SIZE_KEY, country);
    const tier = getCountryTier(country);
    if (!hero || !large || !tier) continue;
    rows.push({
      country,
      name: MARKET_NAMES[country] ?? country,
      tier,
      heroContribution: hero.contribution,
      heroCap: round2(hero.contribution * targetRatio),
      largeCap: round2(large.contribution * targetRatio),
      deliveryDays: hero.deliveryDays,
      guidance: guidanceFor(hero.contribution),
    });
  }
  return rows.sort((a, b) => b.heroCap - a.heroCap);
}

/** ISO date the underlying landed-cost snapshot was generated. */
export function bidCapsGeneratedAt(): string {
  return snapshotGeneratedAt();
}
