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
const GREEK_STANDARD_VAT = 24;

const DEFAULT_FINANCE: PricingFinance = {
  paymentFeePercent: 2.9,
  paymentFeeFixed: 0.3,
  vatPercent: GREEK_STANDARD_VAT,
  source: 'defaults',
};

/** Fee/VAT config, from finance_settings (030) when present, else defaults. */
export async function getPricingFinance(): Promise<PricingFinance> {
  try {
    const { data, error } = await supabaseAdmin
      .from('finance_settings')
      .select('payment_fee_percent, payment_fee_fixed, default_vat_percent')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return DEFAULT_FINANCE;
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
    return DEFAULT_FINANCE;
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

/**
 * Net margin % after Gelato cost, payment fee, and VAT (VAT excluded from
 * margin as pass-through). Returns null when we have no cost estimate.
 *   net_rev = price / (1 + vat)
 *   fee     = price × fee% + fee_fixed
 *   margin  = (net_rev − gelato − fee) / net_rev
 */
export function netMarginPct(
  priceEur: number,
  gelatoCost: number | null,
  fin: PricingFinance
): number | null {
  if (gelatoCost == null) return null;
  const netRev = priceEur / (1 + fin.vatPercent / 100);
  if (netRev <= 0) return null;
  const fee = priceEur * (fin.paymentFeePercent / 100) + fin.paymentFeeFixed;
  const profit = netRev - gelatoCost - fee;
  return (profit / netRev) * 100;
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
