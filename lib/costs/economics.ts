/**
 * Unit-economics read layer.
 *
 * Thin accessors over the cost views defined in sql/030_cost_tracking.sql
 * (order_economics, artwork_economics) plus the finance_settings config and
 * the marketing_spend ledger. Margin is computed in SQL; this module only
 * reads it and rolls the pieces into a P&L summary for the dashboard.
 *
 * All reads use the service-role client (RLS is for the anon key only).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface FinanceSettings {
  payment_fee_percent: number;
  payment_fee_fixed: number;
  default_vat_percent: number;
  monthly_fixed_cost: number;
  creation_fx_usd_to_eur: number;
  reporting_currency: string;
  updated_at: string;
}

const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  payment_fee_percent: 1.9,
  payment_fee_fixed: 0.25,
  default_vat_percent: 0,
  monthly_fixed_cost: 0,
  creation_fx_usd_to_eur: 0.92,
  reporting_currency: 'EUR',
  updated_at: new Date(0).toISOString(),
};

/** The singleton finance_settings row. Falls back to defaults if unset. */
export async function getFinanceSettings(): Promise<FinanceSettings> {
  const { data, error } = await supabaseAdmin
    .from('finance_settings')
    .select(
      'payment_fee_percent, payment_fee_fixed, default_vat_percent, monthly_fixed_cost, creation_fx_usd_to_eur, reporting_currency, updated_at'
    )
    .eq('id', true)
    .maybeSingle();

  if (error || !data) return DEFAULT_FINANCE_SETTINGS;
  return data as FinanceSettings;
}

export interface OrderEconomics {
  id: string;
  name: string | null;
  placed_at: string | null;
  currency: string;
  financial_status: string | null;
  gelato_fulfillment_status: string | null;
  gross_revenue: number;
  discounts: number;
  shipping_charged: number;
  tax_collected: number;
  taxes_included: boolean;
  net_revenue_ex_vat: number;
  production_cost: number | null;
  shipping_cost: number;
  payment_fee: number;
  contribution_margin: number | null;
}

/** One order's full margin breakdown, from the order_economics view. */
export async function getOrderEconomics(orderId: string): Promise<OrderEconomics | null> {
  const { data, error } = await supabaseAdmin
    .from('order_economics')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error || !data) return null;
  return data as OrderEconomics;
}

/** All orders' margin breakdowns, newest first. */
export async function getAllOrderEconomics(): Promise<OrderEconomics[]> {
  const { data, error } = await supabaseAdmin
    .from('order_economics')
    .select('*')
    .order('placed_at', { ascending: false, nullsFirst: false });
  if (error || !data) return [];
  return data as OrderEconomics[];
}

export interface ArtworkEconomics {
  id: string;
  title: string;
  status: string;
  creation_source: string;
  price: number | null;
  currency: string;
  creation_cost: number | null;
  creation_cost_currency: string;
  creation_cost_breakdown: Record<string, unknown>;
  unit_production_cost: number | null;
  units_sold: number;
  gross_revenue: number;
  amortized_creation_per_unit: number | null;
  est_unit_gross_margin: number | null;
  creation_recouped: boolean | null;
}

/** Per-artwork economics, from the artwork_economics view. */
export async function getArtworkEconomics(): Promise<ArtworkEconomics[]> {
  const { data, error } = await supabaseAdmin
    .from('artwork_economics')
    .select('*')
    .order('gross_revenue', { ascending: false });
  if (error || !data) return [];
  return data as ArtworkEconomics[];
}

export interface MarketingSpend {
  id: string;
  spend_date: string;
  channel: string;
  campaign: string | null;
  amount: number;
  currency: string;
  notes: string | null;
  created_at: string;
}

export async function getMarketingSpend(): Promise<MarketingSpend[]> {
  const { data, error } = await supabaseAdmin
    .from('marketing_spend')
    .select('*')
    .order('spend_date', { ascending: false });
  if (error || !data) return [];
  return data as MarketingSpend[];
}

export interface PnlSummary {
  orderCount: number;
  unitsSold: number;
  grossRevenue: number;
  discounts: number;
  shippingCharged: number;
  productionCost: number;
  shippingCost: number;
  paymentFees: number;
  contributionMargin: number;
  /** Sum of creation costs for artworks that have sold at least one unit. */
  creationCostRealized: number;
  marketingSpend: number;
  /** Contribution margin − realized creation cost − marketing. Excludes fixed costs. */
  netAfterCreationAndMarketing: number;
  marketingCac: number | null;
  reportingCurrency: string;
}

/**
 * Roll orders + creation costs + marketing into a single P&L. Only orders
 * with a synced production cost contribute margin (nulls skipped), so the
 * total reflects what we can actually account for.
 */
export async function getPnlSummary(): Promise<PnlSummary> {
  const [orders, artworks, marketing, fs] = await Promise.all([
    getAllOrderEconomics(),
    getArtworkEconomics(),
    getMarketingSpend(),
    getFinanceSettings(),
  ]);

  const sum = (ns: Array<number | null | undefined>) =>
    ns.reduce<number>((acc, n) => acc + (n ?? 0), 0);

  const grossRevenue = sum(orders.map((o) => o.gross_revenue));
  const discounts = sum(orders.map((o) => o.discounts));
  const shippingCharged = sum(orders.map((o) => o.shipping_charged));
  const productionCost = sum(orders.map((o) => o.production_cost));
  const shippingCost = sum(orders.map((o) => o.shipping_cost));
  const paymentFees = sum(orders.map((o) => o.payment_fee));
  const contributionMargin = sum(orders.map((o) => o.contribution_margin));

  // Realized creation cost = creation cost of pieces that have actually
  // sold. Unsold-piece creation cost is catalog investment, not yet a
  // cost against revenue.
  const creationCostRealized = sum(
    artworks.filter((a) => a.units_sold > 0).map((a) => a.creation_cost)
  );

  const marketingSpend = sum(marketing.map((m) => m.amount));
  const unitsSold = sum(artworks.map((a) => a.units_sold));

  return {
    orderCount: orders.length,
    unitsSold,
    grossRevenue: round2(grossRevenue),
    discounts: round2(discounts),
    shippingCharged: round2(shippingCharged),
    productionCost: round2(productionCost),
    shippingCost: round2(shippingCost),
    paymentFees: round2(paymentFees),
    contributionMargin: round2(contributionMargin),
    creationCostRealized: round2(creationCostRealized),
    marketingSpend: round2(marketingSpend),
    netAfterCreationAndMarketing: round2(
      contributionMargin - creationCostRealized - marketingSpend
    ),
    marketingCac: orders.length > 0 && marketingSpend > 0
      ? round2(marketingSpend / orders.length)
      : null,
    reportingCurrency: fs.reporting_currency,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
