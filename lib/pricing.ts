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
 * Classics only — ArtInScale originals are priced per-piece in Shopify
 * and are out of scope here (see docs/PRICING_PLAN.md).
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

const DEFAULT_FINANCE: PricingFinance = {
  paymentFeePercent: 2.9,
  paymentFeeFixed: 0.3,
  vatPercent: 19,
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
    const vat = Number(data.default_vat_percent);
    return {
      paymentFeePercent: Number(data.payment_fee_percent ?? 2.9),
      paymentFeeFixed: Number(data.payment_fee_fixed ?? 0.3),
      // finance_settings.default_vat_percent defaults to 0 ("don't model");
      // a pricing preview still needs a VAT assumption, so fall back to 19.
      vatPercent: vat > 0 ? vat : 19,
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
