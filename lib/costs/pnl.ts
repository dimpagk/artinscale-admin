/**
 * Period P&L read layer.
 *
 * Reads the signed pnl_entries ledger (sql/041_pnl_ledger.sql) through the
 * pnl_by_period / pnl_drilldown SQL functions and pivots the result into a
 * render-ready matrix: display lines + subtotal metrics down the side,
 * periods across the top. All metric math lives in pnl-metrics.ts so the
 * definitions are testable in one place.
 *
 * Also exposes the ledger reads the /economics forms need (cost entries,
 * recurring costs) and the count of orders still awaiting a Gelato
 * production sync, which the P&L footnotes.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  ALL_DISPLAY_LINES,
  METRICS,
  computeMetrics,
  displayLineAmount,
  metricValue,
  type LineSums,
  type PnlMetrics,
} from './pnl-metrics';
import { GRANULARITIES, type PnlGranularity, type DrilldownRow } from './pnl-shared';

// Re-export the client-safe types/constants so existing importers keep
// working. Client components must import these from './pnl-shared' directly
// to avoid bundling this module's server-only supabaseAdmin.
export { GRANULARITIES };
export type { PnlGranularity, DrilldownRow };

export interface PnlColumn {
  /** ISO date of the period start (date_trunc result). */
  period: string;
  /** Human label for the column header, formatted for the granularity. */
  label: string;
  sums: LineSums;
  metrics: PnlMetrics;
}

export interface PnlRow {
  key: string;
  label: string;
  kind: 'line' | 'metric';
  note?: string;
  /** Render bold like a subtotal even though it's a line (Gross revenue). */
  emphasis?: boolean;
  /** One value per column, aligned to PnlMatrix.columns. */
  values: number[];
  /** Total across all history (independent of the visible range). */
  allTime: number;
}

export interface PnlMatrix {
  granularity: PnlGranularity;
  from: string;
  to: string;
  columns: PnlColumn[];
  rows: PnlRow[];
  /** All-history totals, for the "All time" column and the all-time chart. */
  allTime: { sums: LineSums; metrics: PnlMetrics };
}

interface PeriodRow {
  period: string;
  line_key: string;
  amount: number;
}

/**
 * Build the P&L matrix for a granularity + date range. One SQL aggregation
 * (pnl_by_period) returns (period, line_key, amount); everything else is a
 * pivot and the metric roll-up.
 */
export async function getPnl(
  granularity: PnlGranularity,
  from: Date,
  to: Date
): Promise<PnlMatrix> {
  const fromStr = iso(from);
  const toStr = iso(to);

  // The visible range and the all-history totals in parallel. All-time is a
  // separate aggregation (from the epoch of the data, not the visible window)
  // so the "All time" column and chart reflect the whole business, not the
  // last N periods.
  const [{ data, error }, allTimeSums] = await Promise.all([
    supabaseAdmin.rpc('pnl_by_period', {
      p_granularity: granularity,
      p_from: fromStr,
      p_to: toStr,
    }),
    fetchLineSums('year', '2000-01-01', toStr),
  ]);
  if (error) throw new Error(`pnl_by_period failed: ${error.message}`);

  const rows = (data ?? []) as PeriodRow[];

  // Group rows into per-period LineSums.
  const byPeriod = new Map<string, LineSums>();
  for (const r of rows) {
    const key = r.period;
    let sums = byPeriod.get(key);
    if (!sums) {
      sums = {};
      byPeriod.set(key, sums);
    }
    sums[r.line_key] = (sums[r.line_key] ?? 0) + Number(r.amount);
  }

  // Every period in range, ascending — so empty periods still get a column.
  const periods = enumeratePeriods(granularity, from, to);
  const columns: PnlColumn[] = periods.map((period) => {
    const sums = byPeriod.get(period) ?? {};
    return { period, label: formatPeriod(granularity, period), sums, metrics: computeMetrics(sums) };
  });

  const allTimeMetrics = computeMetrics(allTimeSums);
  const matrixRows = buildRows(columns, allTimeSums, allTimeMetrics);

  return {
    granularity,
    from: fromStr,
    to: toStr,
    columns,
    rows: matrixRows,
    allTime: { sums: allTimeSums, metrics: allTimeMetrics },
  };
}

/** Sum pnl_by_period rows across a whole range into one LineSums (no buckets). */
async function fetchLineSums(
  granularity: PnlGranularity,
  fromStr: string,
  toStr: string
): Promise<LineSums> {
  const { data, error } = await supabaseAdmin.rpc('pnl_by_period', {
    p_granularity: granularity,
    p_from: fromStr,
    p_to: toStr,
  });
  if (error) throw new Error(`pnl_by_period (all-time) failed: ${error.message}`);
  const sums: LineSums = {};
  for (const r of (data ?? []) as PeriodRow[]) {
    sums[r.line_key] = (sums[r.line_key] ?? 0) + Number(r.amount);
  }
  return sums;
}

/** One month's headline metrics, for the all-history metric time series. */
export interface MonthlyMetricsPoint {
  period: string;
  label: string;
  /** Product subtotal + shipping charged (same as the matrix's top line). */
  grossRevenue: number;
  netRevenue: number;
  cm1: number;
  cm2: number;
  cm3: number;
  ebitda: number;
}

/**
 * Headline metrics per month across ALL history (independent of the matrix's
 * visible range). Starts at the first month with any activity and fills gap
 * months with zeros so the time axis is continuous.
 */
export async function getMonthlyMetricSeries(to: Date = new Date()): Promise<MonthlyMetricsPoint[]> {
  const toStr = iso(to);
  const { data, error } = await supabaseAdmin.rpc('pnl_by_period', {
    p_granularity: 'month',
    p_from: '2000-01-01',
    p_to: toStr,
  });
  if (error) throw new Error(`pnl_by_period (monthly series) failed: ${error.message}`);

  const rows = (data ?? []) as PeriodRow[];
  if (rows.length === 0) return [];

  const byPeriod = new Map<string, LineSums>();
  for (const r of rows) {
    let sums = byPeriod.get(r.period);
    if (!sums) {
      sums = {};
      byPeriod.set(r.period, sums);
    }
    sums[r.line_key] = (sums[r.line_key] ?? 0) + Number(r.amount);
  }

  const first = [...byPeriod.keys()].sort()[0];
  const periods = enumeratePeriods('month', new Date(`${first}T00:00:00Z`), to);

  return periods.map((period) => {
    const sums = byPeriod.get(period) ?? {};
    const m = computeMetrics(sums);
    return {
      period,
      label: formatPeriod('month', period),
      grossRevenue: Math.round(((sums.gross_revenue ?? 0) + (sums.shipping_revenue ?? 0)) * 100) / 100,
      netRevenue: m.netRevenue,
      cm1: m.cm1,
      cm2: m.cm2,
      cm3: m.cm3,
      ebitda: m.ebitda,
    };
  });
}

/** Interleave display lines with their subtotal metric rows. */
function buildRows(
  columns: PnlColumn[],
  allTimeSums: LineSums,
  allTimeMetrics: PnlMetrics
): PnlRow[] {
  const out: PnlRow[] = [];
  for (const line of ALL_DISPLAY_LINES) {
    out.push({
      key: line.key,
      label: line.label,
      kind: 'line',
      emphasis: line.emphasis,
      values: columns.map((c) => displayLineAmount(c.sums, line)),
      allTime: displayLineAmount(allTimeSums, line),
    });
    for (const metric of METRICS.filter((m) => m.afterLineKey === line.key)) {
      out.push({
        key: metric.key,
        label: metric.label,
        kind: 'metric',
        note: metric.note,
        values: columns.map((c) => metricValue(c.metrics, metric.key)),
        allTime: metricValue(allTimeMetrics, metric.key),
      });
    }
  }
  return out;
}

// ── Drill-down ───────────────────────────────────────────────────
// DrilldownRow is defined in ./pnl-shared (client-safe) and re-exported above.

const DISPLAY_LINE_RAW_KEYS: Record<string, string[]> = Object.fromEntries(
  ALL_DISPLAY_LINES.map((l) => [l.key, l.rawKeys])
);

/**
 * The underlying entries behind one matrix cell (a display line in a
 * period). Aggregated display lines (tools, other) fan out across their raw
 * keys. Metric rows have no drill-down.
 */
export async function getPnlDrilldown(
  granularity: PnlGranularity,
  period: string,
  displayLineKey: string
): Promise<DrilldownRow[]> {
  const rawKeys = DISPLAY_LINE_RAW_KEYS[displayLineKey];
  if (!rawKeys) return [];

  const results = await Promise.all(
    rawKeys.map((lineKey) =>
      supabaseAdmin.rpc('pnl_drilldown', {
        p_granularity: granularity,
        p_period: period,
        p_line_key: lineKey,
      })
    )
  );

  const raw: Array<Omit<DrilldownRow, 'label' | 'href'>> = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`pnl_drilldown failed: ${error.message}`);
    for (const r of (data ?? []) as PeriodRowRef[]) {
      raw.push({
        occurred_on: r.occurred_on,
        line_key: r.line_key,
        amount: Number(r.amount),
        ref_type: r.ref_type,
        ref_id: r.ref_id,
      });
    }
  }

  const enriched = await enrichRefs(raw);
  enriched.sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1));
  return enriched;
}

interface PeriodRowRef {
  occurred_on: string;
  line_key: string;
  amount: number;
  ref_type: string;
  ref_id: string;
}

/** Batch-resolve ref ids to labels + links, grouped by ref_type. */
async function enrichRefs(
  rows: Array<Omit<DrilldownRow, 'label' | 'href'>>
): Promise<DrilldownRow[]> {
  const idsByType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!idsByType.has(r.ref_type)) idsByType.set(r.ref_type, new Set());
    idsByType.get(r.ref_type)!.add(r.ref_id);
  }

  const orderNames = new Map<string, string>();
  const entryLabels = new Map<string, string>();
  const recurringNames = new Map<string, string>();

  const orderIds = [...(idsByType.get('order') ?? [])];
  const entryIds = [...(idsByType.get('cost_entry') ?? [])];
  const recurringIds = [...(idsByType.get('recurring') ?? [])];

  await Promise.all([
    orderIds.length
      ? supabaseAdmin
          .from('orders')
          .select('id, name')
          .in('id', orderIds)
          .then(({ data }) =>
            (data ?? []).forEach((o) => orderNames.set(o.id as string, (o.name as string) ?? 'Order'))
          )
      : Promise.resolve(),
    entryIds.length
      ? supabaseAdmin
          .from('cost_entries')
          .select('id, description, category, campaign')
          .in('id', entryIds)
          .then(({ data }) =>
            (data ?? []).forEach((e) =>
              entryLabels.set(
                e.id as string,
                (e.description as string) || (e.campaign as string) || (e.category as string)
              )
            )
          )
      : Promise.resolve(),
    recurringIds.length
      ? supabaseAdmin
          .from('recurring_costs')
          .select('id, name')
          .in('id', recurringIds)
          .then(({ data }) =>
            (data ?? []).forEach((rc) => recurringNames.set(rc.id as string, rc.name as string))
          )
      : Promise.resolve(),
  ]);

  return rows.map((r) => {
    switch (r.ref_type) {
      case 'order':
        return { ...r, label: orderNames.get(r.ref_id) ?? 'Order', href: `/orders/${r.ref_id}` };
      case 'cost_entry':
        return { ...r, label: entryLabels.get(r.ref_id) ?? 'Expense', href: null };
      case 'recurring':
        return { ...r, label: recurringNames.get(r.ref_id) ?? 'Subscription', href: null };
      case 'generation':
        return { ...r, label: 'AI generation', href: null };
      default:
        return { ...r, label: r.ref_type, href: null };
    }
  });
}

// ── Ledger reads for the /economics forms ────────────────────────

export interface CostEntry {
  id: string;
  occurred_on: string;
  category: string;
  amount: number;
  currency: string;
  description: string | null;
  channel: string | null;
  campaign: string | null;
  source: string;
  created_at: string;
}

export async function getCostEntries(limit = 50): Promise<CostEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('cost_entries')
    .select('id, occurred_on, category, amount, currency, description, channel, campaign, source, created_at')
    .order('occurred_on', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as CostEntry[];
}

export interface RecurringCost {
  id: string;
  name: string;
  category: string;
  monthly_amount: number;
  currency: string;
  active_from: string;
  active_to: string | null;
  notes: string | null;
}

export async function getRecurringCosts(): Promise<RecurringCost[]> {
  const { data, error } = await supabaseAdmin
    .from('recurring_costs')
    .select('id, name, category, monthly_amount, currency, active_from, active_to, notes')
    .order('active_from', { ascending: false });
  if (error || !data) return [];
  return data as RecurringCost[];
}

/**
 * Orders that are revenue-recognized but have no synced Gelato production
 * cost yet. Their production line reads as 0, so margins for their periods
 * are optimistic until the order_sync cron fills the cost — the P&L
 * footnotes this count.
 */
export async function getPendingProductionCount(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('order_economics')
    .select('id', { count: 'exact', head: true })
    .is('production_cost', null)
    .in('financial_status', ['paid', 'partially_refunded']);
  return count ?? 0;
}

// ── Date helpers (server-side; native Date is fine here) ──────────

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Default range for a granularity: enough trailing periods to read a trend,
 * through today. day→30, week→12, month→6, quarter→6, year→4.
 */
export function defaultRange(granularity: PnlGranularity, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (granularity) {
    case 'day':
      from.setUTCDate(from.getUTCDate() - 29);
      break;
    case 'week':
      from.setUTCDate(from.getUTCDate() - 7 * 11);
      break;
    case 'month':
      from.setUTCMonth(from.getUTCMonth() - 5, 1);
      break;
    case 'quarter':
      from.setUTCMonth(from.getUTCMonth() - 15, 1);
      break;
    case 'year':
      from.setUTCFullYear(from.getUTCFullYear() - 3, 0, 1);
      break;
  }
  return { from, to };
}

/** All period-start dates (date_trunc keys) in [from, to], ascending. */
function enumeratePeriods(granularity: PnlGranularity, from: Date, to: Date): string[] {
  const cursor = truncate(granularity, from);
  const end = truncate(granularity, to);
  const out: string[] = [];
  // Guard against pathological ranges.
  for (let i = 0; i < 2000 && cursor <= end; i++) {
    out.push(iso(cursor));
    advance(granularity, cursor);
  }
  return out;
}

function truncate(granularity: PnlGranularity, d: Date): Date {
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  switch (granularity) {
    case 'day':
      return c;
    case 'week': {
      // ISO week starts Monday, matching Postgres date_trunc('week', ...).
      const dow = (c.getUTCDay() + 6) % 7;
      c.setUTCDate(c.getUTCDate() - dow);
      return c;
    }
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    case 'quarter':
      return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
    case 'year':
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  }
}

function advance(granularity: PnlGranularity, d: Date): void {
  switch (granularity) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'week':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'quarter':
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatPeriod(granularity: PnlGranularity, isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (granularity) {
    case 'day':
      return `${MONTHS[m]} ${d.getUTCDate()}`;
    case 'week':
      return `wk ${MONTHS[m]} ${d.getUTCDate()}`;
    case 'month':
      return `${MONTHS[m]} ${y}`;
    case 'quarter':
      return `Q${Math.floor(m / 3) + 1} ${y}`;
    case 'year':
      return `${y}`;
  }
}
