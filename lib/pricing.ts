/**
 * Classics (external print) pricing read layer + margin math for the
 * /pricing editor.
 *
 * Deliberately self-contained: it does NOT import lib/costs/* (the
 * cost-tracking work is landing in a parallel change and its migration
 * 030 isn't applied to prod yet). It queries finance_settings directly
 * with a graceful fallback, so this page works whether or not 030 is
 * live. Once 030 is applied and VAT/fees are configured there, this page
 * picks them up automatically.
 *
 * Covers both tabs: classics size pricing (below) and, for the originals
 * editor, a light lookup of each piece's Shopify refs (getArtworkShopifyRefs)
 * so the price editor knows which pieces are published. Per-piece economics
 * come from lib/costs/economics (artwork_economics view).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  DEFAULT_FINANCE as DEFAULT_FINANCE_MATH,
  GREEK_STANDARD_VAT,
  type PricingFinance,
  type SizePriceStat,
  type SizeMixEntry,
} from '@/lib/pricing-math';

// Re-exported so server callers can keep importing the margin math from
// '@/lib/pricing'. The pure implementation lives in pricing-math (no
// server imports) so Client Components can share it.
export {
  netContributionEur,
  netMarginPct,
  type PricingFinance,
  type SizePriceStat,
  type SizeMixEntry,
} from '@/lib/pricing-math';

/**
 * Median EUR sell price of PUBLISHED artworks (listed or sold) per size,
 * keyed by product_type. Powers the artwork form's "recommended price"
 * hint so new pieces price in line with what's already live at that size.
 * EUR-only (matches the EUR-based margin preview). Empty map on any error.
 */
export async function getPublishedPriceStatsBySize(): Promise<Record<string, SizePriceStat>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('artworks')
      .select('product_type, price, currency, status')
      .in('status', ['listed', 'sold'])
      .not('product_type', 'is', null)
      .not('price', 'is', null);
    if (error || !data) return {};

    const bySize: Record<string, number[]> = {};
    for (const r of data as Array<{
      product_type: string | null;
      price: number | null;
      currency: string | null;
    }>) {
      if (!r.product_type || r.price == null) continue;
      if ((r.currency ?? 'EUR') !== 'EUR') continue;
      (bySize[r.product_type] ??= []).push(Number(r.price));
    }

    const out: Record<string, SizePriceStat> = {};
    for (const [size, prices] of Object.entries(bySize)) {
      prices.sort((a, b) => a - b);
      const n = prices.length;
      const mid = Math.floor(n / 2);
      const median = n % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
      out[size] = { count: n, median, min: prices[0], max: prices[n - 1] };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Published catalog split by size: pieces (supply) and units sold (demand)
 * per product_type. Powers the artwork form's "size mix" breakdown so the
 * operator can see where the live catalog is concentrated when choosing a
 * size. Counts listed + sold pieces of any currency (a mix, not a price);
 * sizes with no published pieces are simply absent. Empty on any error.
 */
export async function getSizeMix(): Promise<SizeMixEntry[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('artworks')
      .select('product_type, edition_sold')
      .in('status', ['listed', 'sold'])
      .not('product_type', 'is', null);
    if (error || !data) return [];

    const by: Record<string, { pieces: number; unitsSold: number }> = {};
    for (const r of data as Array<{
      product_type: string | null;
      edition_sold: number | null;
    }>) {
      if (!r.product_type) continue;
      const b = (by[r.product_type] ??= { pieces: 0, unitsSold: 0 });
      b.pieces += 1;
      b.unitsSold += Number(r.edition_sold ?? 0);
    }

    return Object.entries(by).map(([sizeKey, v]) => ({
      sizeKey,
      pieces: v.pieces,
      unitsSold: v.unitsSold,
    }));
  } catch {
    return [];
  }
}

export interface PrintSizePrice {
  size_key: string;
  display_name: string;
  width_cm: number;
  height_cm: number;
  price_eur: number;
  gelato_cost_estimate_eur: number | null;
  cost_source: 'estimated' | 'actual';
  active: boolean;
  updated_at: string;
}

// Mirrors artinscale-nextjs/lib/orders/print-pricing.ts EXTERNAL_PRINT_PRICING
// + the seed in sql/032_pricing.sql, so the page renders sensibly even
// before migration 032 is applied. Kept in sync manually.
const FALLBACK_ROWS: PrintSizePrice[] = [
  row('museum-poster-21x30', '21 × 30 cm', 21, 30, 29, 14),
  row('museum-poster-30x40', '30 × 40 cm', 30, 40, 39, 19),
  row('museum-poster-30x45', '30 × 45 cm', 30, 45, 42, 20),
  row('museum-poster-40x50', '40 × 50 cm', 40, 50, 55, 26),
  row('museum-poster-50x70', '50 × 70 cm', 50, 70, 79, 38),
  row('museum-poster-60x90', '60 × 90 cm', 60, 90, 109, 54),
  row('museum-poster-70x100', '70 × 100 cm', 70, 100, 139, 70),
];

function row(
  size_key: string,
  display_name: string,
  width_cm: number,
  height_cm: number,
  price_eur: number,
  gelato: number
): PrintSizePrice {
  return {
    size_key,
    display_name,
    width_cm,
    height_cm,
    price_eur,
    gelato_cost_estimate_eur: gelato,
    cost_source: 'estimated',
    active: true,
    updated_at: new Date(0).toISOString(),
  };
}

/** Fee/VAT config, from finance_settings (030) when present, else defaults. */
export async function getPricingFinance(): Promise<PricingFinance> {
  try {
    const { data, error } = await supabaseAdmin
      .from('finance_settings')
      .select('payment_fee_percent, payment_fee_fixed, default_vat_percent')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return DEFAULT_FINANCE_MATH;
    return {
      paymentFeePercent: Number(data.payment_fee_percent ?? 2.9),
      paymentFeeFixed: Number(data.payment_fee_fixed ?? 0.3),
      // Respect the operator's configured rate as the floor assumption,
      // including 0 (a fully VAT-exempt seller). Only fall back to the
      // Greek standard rate when the column is null/unset.
      vatPercent: data.default_vat_percent == null ? GREEK_STANDARD_VAT : Number(data.default_vat_percent),
      source: 'finance_settings',
    };
  } catch {
    return DEFAULT_FINANCE_MATH;
  }
}

/** Classics price rows, from the DB (032) when present, else fallback. */
export async function getPrintSizePricing(): Promise<{
  rows: PrintSizePrice[];
  source: 'db' | 'fallback';
}> {
  try {
    const { data, error } = await supabaseAdmin
      .from('print_size_pricing')
      .select('*')
      .order('width_cm', { ascending: true })
      .order('height_cm', { ascending: true });
    if (error || !data || data.length === 0) {
      return { rows: FALLBACK_ROWS, source: 'fallback' };
    }
    return { rows: data as PrintSizePrice[], source: 'db' };
  } catch {
    return { rows: FALLBACK_ROWS, source: 'fallback' };
  }
}

// ─── Discount campaigns (migration 033) ─────────────────────────────

export interface PricingCampaign {
  id: string;
  name: string;
  scope: 'classics' | 'originals' | 'all';
  discount_percent: number;
  status: 'draft' | 'active' | 'ended';
  starts_at: string | null;
  ends_at: string | null;
  applied_at: string | null;
  reverted_at: string | null;
  created_at: string;
}

/** All campaigns newest-first. Empty when the table is absent (033 not run). */
export async function getCampaigns(): Promise<PricingCampaign[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('pricing_campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as PricingCampaign[];
  } catch {
    return [];
  }
}

export function findActiveCampaign(campaigns: PricingCampaign[]): PricingCampaign | null {
  return campaigns.find((c) => c.status === 'active') ?? null;
}

/**
 * The active campaign that applies to a catalog: one whose scope is that
 * catalog or the store-wide 'all'. Lets Classics and Originals each show
 * (and gate) their own live sale independently.
 */
export function findActiveCampaignForScope(
  campaigns: PricingCampaign[],
  scope: 'classics' | 'originals'
): PricingCampaign | null {
  return (
    campaigns.find((c) => c.status === 'active' && (c.scope === scope || c.scope === 'all')) ??
    null
  );
}

/** Campaigns that belong to a catalog (its own scope or 'all'), for its panel. */
export function campaignsForScope(
  campaigns: PricingCampaign[],
  scope: 'classics' | 'originals'
): PricingCampaign[] {
  return campaigns.filter((c) => c.scope === scope || c.scope === 'all');
}

// ─── Originals editor: per-piece Shopify refs ───────────────────────

export interface ArtworkShopifyRef {
  shopify_product_id: string | null;
  shopify_handle: string | null;
}

/**
 * Map of artwork id → its Shopify product refs. The originals price editor
 * uses this to tell published pieces (repriceable on Shopify) from drafts
 * (DB price only). The artwork_economics view doesn't carry these columns,
 * so we read them straight from artworks. Empty map on any error so the
 * page still renders.
 */
export async function getArtworkShopifyRefs(): Promise<Record<string, ArtworkShopifyRef>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('artworks')
      .select('id, shopify_product_id, shopify_handle');
    if (error || !data) return {};
    const map: Record<string, ArtworkShopifyRef> = {};
    for (const r of data as Array<{
      id: string;
      shopify_product_id: string | null;
      shopify_handle: string | null;
    }>) {
      map[r.id] = {
        shopify_product_id: r.shopify_product_id,
        shopify_handle: r.shopify_handle,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/** Map of artwork id → its print size key (`product_type`, e.g. museum-poster-50x70). */
export async function getArtworkSizes(): Promise<Record<string, string>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('artworks')
      .select('id, product_type');
    if (error || !data) return {};
    const map: Record<string, string> = {};
    for (const r of data as Array<{ id: string; product_type: string | null }>) {
      if (r.product_type) map[r.id] = r.product_type;
    }
    return map;
  } catch {
    return {};
  }
}

/** A listed piece for catalog-grounded economics: its size, live price, units sold. */
export interface ListedPrintPiece {
  id: string;
  title: string;
  sizeKey: string;
  price: number;
  unitsSold: number;
}

/**
 * The pieces that are actually for sale — status = 'listed', with a valid
 * print size and price. This is the universe the bid-caps calculation is
 * grounded in (retired / draft pieces don't generate sales). `unitsSold` is
 * carried for future sales-weighting but not used in the average yet.
 */
export async function getListedPrintPieces(): Promise<ListedPrintPiece[]> {
  try {
    const { data: arts, error } = await supabaseAdmin
      .from('artworks')
      .select('id, title, product_type, price')
      .eq('status', 'listed');
    if (error || !arts) return [];

    // units_sold lives in the artwork_economics view; carried for weighting.
    const units: Record<string, number> = {};
    const { data: econ } = await supabaseAdmin
      .from('artwork_economics')
      .select('id, units_sold');
    for (const e of (econ ?? []) as Array<{ id: string; units_sold: number | null }>) {
      units[e.id] = e.units_sold ?? 0;
    }

    return (arts as Array<{
      id: string;
      title: string | null;
      product_type: string | null;
      price: number | null;
    }>)
      .filter(
        (a) =>
          a.price != null &&
          a.product_type != null &&
          a.product_type.startsWith('museum-poster-')
      )
      .map((a) => ({
        id: a.id,
        title: a.title ?? '',
        sizeKey: a.product_type as string,
        price: Number(a.price),
        unitsSold: units[a.id] ?? 0,
      }));
  } catch {
    return [];
  }
}
