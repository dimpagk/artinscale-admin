/**
 * Per-order overhead inputs for the per-EUR-1 economics: how much creation
 * cost to amortise per sale, and how much monthly opex to charge each order.
 *
 * Sources (all operator-tunable without a deploy):
 *   - finance_settings.amort_lifetime_units    lifetime sales per piece
 *   - finance_settings.planned_monthly_orders  planning volume for opex
 *                                              (0 = actual 28-day orders)
 *   - finance_settings.monthly_fixed_cost      flat monthly overhead
 *   - recurring_costs                          active subscription rows
 *
 * Migration: sql/047_amort_opex_settings.sql (hand-applied). Reads are
 * tolerant: if the 047 columns don't exist yet, defaults (10 / 0) apply and
 * nothing else on the page degrades.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

export const DEFAULT_AMORT_UNITS = 10;

export interface PerOrderOverheads {
  /** Lifetime sales assumed per piece for creation amortisation. */
  amortUnits: number;
  /** Monthly opex spread per order (EUR). */
  opexPerOrder: number;
  /** Total monthly opex: active subscriptions + monthly_fixed_cost (EUR). */
  monthlyOpex: number;
  /** Orders in the trailing 28 days (the actual-volume denominator). */
  ordersLast28: number;
  /** Operator-set planning volume; 0 means "use actual". */
  plannedMonthlyOrders: number;
  /** Human-readable basis for the spread, for UI copy. */
  basis: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function isActiveRecurring(row: { active_from: string; active_to: string | null }): boolean {
  const now = new Date().toISOString().slice(0, 10);
  return row.active_from <= now && (row.active_to == null || row.active_to >= now);
}

export async function getPerOrderOverheads(): Promise<PerOrderOverheads> {
  const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

  const [knobsRes, fixedRes, recurringRes, ordersRes] = await Promise.all([
    // 047 columns: tolerate the migration not being applied yet.
    supabaseAdmin
      .from('finance_settings')
      .select('amort_lifetime_units, planned_monthly_orders')
      .eq('id', true)
      .maybeSingle(),
    supabaseAdmin
      .from('finance_settings')
      .select('monthly_fixed_cost')
      .eq('id', true)
      .maybeSingle(),
    supabaseAdmin
      .from('recurring_costs')
      .select('monthly_amount, active_from, active_to'),
    supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since),
  ]);

  const knobs = knobsRes.error ? null : knobsRes.data;
  const amortUnits = Number(knobs?.amort_lifetime_units ?? DEFAULT_AMORT_UNITS);
  const plannedMonthlyOrders = Number(knobs?.planned_monthly_orders ?? 0);

  const monthlyFixed = Number(
    (fixedRes.error ? null : fixedRes.data)?.monthly_fixed_cost ?? 0
  );
  const recurringSum = (recurringRes.error ? [] : recurringRes.data ?? [])
    .filter(isActiveRecurring)
    .reduce((s, r) => s + Number(r.monthly_amount ?? 0), 0);
  const monthlyOpex = round2(monthlyFixed + recurringSum);

  const ordersLast28 = ordersRes.count ?? 0;
  const usingPlan = plannedMonthlyOrders > 0;
  const denominator = usingPlan ? plannedMonthlyOrders : Math.max(ordersLast28, 1);
  const opexPerOrder = round2(monthlyOpex / denominator);

  const basis = usingPlan
    ? `at ${plannedMonthlyOrders} planned orders/month`
    : `at actual 28-day volume (${ordersLast28} order${ordersLast28 === 1 ? '' : 's'}, min 1)`;

  return {
    amortUnits: amortUnits > 0 ? amortUnits : DEFAULT_AMORT_UNITS,
    opexPerOrder,
    monthlyOpex,
    ordersLast28,
    plannedMonthlyOrders,
    basis,
  };
}
