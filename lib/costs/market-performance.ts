/**
 * Per-country marketing actuals: what we spent and sold in each market, to
 * sit next to the allowable-CAC caps (lib/costs/bid-caps).
 *
 * Two independent sources, merged by ISO country:
 *   - Meta insights (breakdowns=country): spend, attributed purchases, value.
 *     Gives the Meta-attributed CAC and ROAS. Needs META_AD_ACCOUNT_ID +
 *     META_ADS_ACCESS_TOKEN; returns metaConfigured=false (not an error) when
 *     those aren't set, so the view degrades to caps + Shopify orders only.
 *   - Shopify orders (orders.shipping_address.country_code): real orders
 *     shipped to each country in the window. Gives the blended CAC
 *     (Meta spend ÷ all country orders) as a cross-check.
 *
 * Live-fetch on load (the page is dynamic). No DB writes.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

const META_API_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v18.0';

// Purchase can surface under several action types depending on pixel setup;
// take the first that's present, in preference order.
const PURCHASE_ACTION_TYPES = [
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
];

export interface CountryActuals {
  /** Meta spend in the window (account currency). */
  spend: number;
  /** Meta-attributed purchases. */
  metaOrders: number;
  /** Meta-attributed purchase value. */
  metaRevenue: number;
  /** Shopify orders shipped to this country in the window. */
  shopifyOrders: number;
}

export interface MarketActuals {
  metaConfigured: boolean;
  days: number;
  currency: string;
  byCountry: Record<string, CountryActuals>;
  /** Set when Meta was configured but the API call failed. */
  error?: string;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pickAction(
  arr: Array<{ action_type: string; value: string }> | undefined
): number {
  if (!arr) return 0;
  for (const t of PURCHASE_ACTION_TYPES) {
    const hit = arr.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

function windowSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function shopifyOrdersByCountry(days: number): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('shipping_address, created_at')
    .gte('created_at', windowSince(days));
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const o of data as Array<{ shipping_address: unknown }>) {
    const sa =
      typeof o.shipping_address === 'string'
        ? safeParse(o.shipping_address)
        : o.shipping_address;
    const cc = (sa as { country_code?: string } | null)?.country_code;
    if (cc) {
      const key = cc.toUpperCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

async function metaByCountry(days: number): Promise<{
  configured: boolean;
  currency: string;
  error?: string;
  rows: Record<string, { spend: number; orders: number; revenue: number }>;
}> {
  const acct = (process.env.META_AD_ACCOUNT_ID ?? '').replace(/^act_/, '');
  const token =
    process.env.META_ADS_ACCESS_TOKEN ?? process.env.META_GRAPH_ACCESS_TOKEN;
  if (!acct || !token) return { configured: false, currency: 'EUR', rows: {} };

  const timeRange = JSON.stringify({
    since: windowSince(days).slice(0, 10),
    until: new Date().toISOString().slice(0, 10),
  });
  const url =
    `https://graph.facebook.com/${META_API_VERSION}/act_${acct}/insights` +
    `?level=account&breakdowns=country` +
    `&fields=spend,actions,action_values,account_currency` +
    `&time_range=${encodeURIComponent(timeRange)}&limit=500` +
    `&access_token=${token}`;

  try {
    const res = await fetch(url);
    const body = await res.json();
    if (body.error) {
      return { configured: true, currency: 'EUR', error: body.error.message, rows: {} };
    }
    const rows: Record<string, { spend: number; orders: number; revenue: number }> = {};
    let currency = 'EUR';
    for (const d of (body.data ?? []) as Array<{
      country?: string;
      spend?: string;
      account_currency?: string;
      actions?: Array<{ action_type: string; value: string }>;
      action_values?: Array<{ action_type: string; value: string }>;
    }>) {
      currency = d.account_currency ?? currency;
      const cc = String(d.country ?? '').toUpperCase();
      if (!cc) continue;
      rows[cc] = {
        spend: Number(d.spend) || 0,
        orders: pickAction(d.actions),
        revenue: pickAction(d.action_values),
      };
    }
    return { configured: true, currency, rows };
  } catch (e) {
    return { configured: true, currency: 'EUR', error: (e as Error).message, rows: {} };
  }
}

/** Merge Meta spend/conversions and Shopify orders per country over `days`. */
export async function getMarketActuals(days = 28): Promise<MarketActuals> {
  const [meta, shopify] = await Promise.all([
    metaByCountry(days),
    shopifyOrdersByCountry(days),
  ]);
  const byCountry: Record<string, CountryActuals> = {};
  const countries = new Set([...Object.keys(meta.rows), ...Object.keys(shopify)]);
  for (const c of countries) {
    byCountry[c] = {
      spend: meta.rows[c]?.spend ?? 0,
      metaOrders: meta.rows[c]?.orders ?? 0,
      metaRevenue: meta.rows[c]?.revenue ?? 0,
      shopifyOrders: shopify[c] ?? 0,
    };
  }
  return {
    metaConfigured: meta.configured,
    days,
    currency: meta.currency,
    byCountry,
    error: meta.error,
  };
}
