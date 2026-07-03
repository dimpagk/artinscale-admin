import { Suspense } from 'react';
import { PageHeader } from '@/components/admin-ui';
import { getArtworkEconomics, getFinanceSettings } from '@/lib/costs/economics';
import {
  getPnl,
  getMonthlyMetricSeries,
  getCostEntries,
  getRecurringCosts,
  getPendingProductionCount,
  defaultRange,
  GRANULARITIES,
  type PnlGranularity,
} from '@/lib/costs/pnl';
import {
  saveFinanceSettingsAction,
  addCostEntryAction,
  deleteCostEntryAction,
  addRecurringCostAction,
  updateRecurringCostAction,
  deleteRecurringCostAction,
} from './actions';
import { GranularityToggle } from './granularity-toggle';
import { PnlTrendChart } from './pnl-trend-chart';
import { PnlAllTimeChart } from './pnl-alltime-chart';
import { PnlMatrix } from './pnl-matrix';

function money(amount: number | null | undefined, currency = 'EUR'): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
}

const EXPENSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'marketing', label: 'Marketing' },
  { value: 'creation_purchase', label: 'Buying art / licenses' },
  { value: 'creation_processing', label: 'Upscales + mockups' },
  { value: 'royalty_flat', label: 'Artist flat fee' },
  { value: 'tools_shopify', label: 'Tools · Shopify' },
  { value: 'tools_gelato', label: 'Tools · Gelato' },
  { value: 'tools_vercel', label: 'Tools · Vercel' },
  { value: 'tools_ai', label: 'Tools · AI platforms' },
  { value: 'tools_other', label: 'Tools · other' },
  { value: 'shipping_other', label: 'Shipping (other)' },
  { value: 'other', label: 'Other opex' },
];

const SUBSCRIPTION_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'tools_shopify', label: 'Shopify' },
  { value: 'tools_gelato', label: 'Gelato' },
  { value: 'tools_vercel', label: 'Vercel' },
  { value: 'tools_ai', label: 'AI platforms' },
  { value: 'tools_other', label: 'Other tools' },
  { value: 'other', label: 'Other' },
];

function parseGranularity(raw: string | undefined): PnlGranularity {
  return (GRANULARITIES as string[]).includes(raw ?? '') ? (raw as PnlGranularity) : 'month';
}

export default async function EconomicsPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const { g } = await searchParams;
  const granularity = parseGranularity(g);
  const { from, to } = defaultRange(granularity);

  const [matrix, metricSeries, artworks, costEntries, recurring, settings, pendingProduction] = await Promise.all([
    getPnl(granularity, from, to),
    getMonthlyMetricSeries(to),
    getArtworkEconomics(),
    getCostEntries(),
    getRecurringCosts(),
    getFinanceSettings(),
    getPendingProductionCount(),
  ]);
  const cur = settings.reporting_currency;

  // Headline = the most recent period in the range.
  const latest = matrix.columns[matrix.columns.length - 1];

  const trend = matrix.columns.map((c) => ({
    label: c.label,
    netRevenue: c.metrics.netRevenue,
    cm2: c.metrics.cm2,
    ebitda: c.metrics.ebitda,
  }));
  const matrixColumns = matrix.columns.map((c) => ({
    period: c.period,
    label: c.label,
    netRevenue: c.metrics.netRevenue,
  }));


  return (
    <div className="space-y-6">
      <PageHeader
        title="Economics"
        description="Profit & loss by day, week, month, quarter or year. Order revenue and per-order costs come from live orders; creation, marketing and tools are booked at the date they occur. VAT is shown but excluded from every margin (it is pass-through)."
      />

      {/* ── Controls + headline ─────────────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <Suspense fallback={<div className="h-9 w-72 rounded-lg border border-gray-200 bg-white" />}>
          <GranularityToggle value={granularity} />
        </Suspense>
        {pendingProduction > 0 && (
          <p className="text-xs text-amber-600">
            {pendingProduction} order{pendingProduction === 1 ? '' : 's'} awaiting Gelato production sync — their
            margin reads optimistically until the next order sync.
          </p>
        )}
      </section>

      {latest && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={`Net revenue · ${latest.label}`} value={money(latest.metrics.netRevenue, cur)} />
          <Stat label="CM2" value={money(latest.metrics.cm2, cur)} sub="after fulfillment + fees" />
          <Stat label="EBITDA" value={money(latest.metrics.ebitda, cur)} sub="after creation, marketing, tools" />
          <Stat
            label="Net profit"
            value={money(latest.metrics.netProfit, cur)}
            sub="tax / D&A not modelled yet"
            emphatic
          />
        </section>
      )}

      {/* ── Charts: period trend + all-time totals ──── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Trend</h2>
          <PnlTrendChart data={trend} currency={cur} />
        </section>
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Cumulative metrics · monthly, all history</h2>
          <PnlAllTimeChart data={metricSeries} currency={cur} />
        </section>
      </div>

      {/* ── P&L matrix ──────────────────────────────── */}
      <PnlMatrix granularity={granularity} columns={matrixColumns} rows={matrix.rows} currency={cur} />

      <p className="text-xs text-gray-400">
        Refunds are not yet captured: orders marked refunded are excluded from revenue rather than shown as a
        negative line at the refund date. AI generation converts USD to {cur} at the daily ECB reference rate.
      </p>

      {/* ── Per-artwork ─────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Per-artwork economics</h2>
        <p className="mb-3 text-xs text-gray-500">
          Unit economics: creation cost amortised over units sold to date. Separate from the P&L above, which
          expenses creation at the date incurred.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2 pr-3">Piece</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3 text-right">Creation</th>
                <th className="py-2 pr-3 text-right">Units</th>
                <th className="py-2 pr-3 text-right">Revenue</th>
                <th className="py-2 pr-3 text-right">Amort./unit</th>
                <th className="py-2 pr-3 text-right">Recouped</th>
              </tr>
            </thead>
            <tbody>
              {artworks.map((a) => (
                <tr key={a.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3">
                    <a href={`/artworks/${a.id}`} className="font-medium text-gray-900 hover:underline">
                      {a.title}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-gray-500">{a.creation_source}</td>
                  <td className="py-2 pr-3 text-right">{money(a.creation_cost, a.creation_cost_currency)}</td>
                  <td className="py-2 pr-3 text-right">{a.units_sold}</td>
                  <td className="py-2 pr-3 text-right">{money(a.gross_revenue, a.currency)}</td>
                  <td className="py-2 pr-3 text-right text-gray-500">
                    {a.amortized_creation_per_unit != null
                      ? money(a.amortized_creation_per_unit, a.creation_cost_currency)
                      : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {a.creation_cost == null ? (
                      <span className="text-gray-300">—</span>
                    ) : a.creation_recouped ? (
                      <span className="text-emerald-600">✓</span>
                    ) : (
                      <span className="text-amber-600">no</span>
                    )}
                  </td>
                </tr>
              ))}
              {artworks.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-gray-400">
                    No artworks yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Expense ledger ─────────────────────────── */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Expenses</h2>
          <p className="mb-3 text-xs text-gray-500">
            Any non-order cost, booked at the date it occurred. Marketing, art purchases, one-off tool charges.
          </p>
          <form action={addCostEntryAction} className="mb-4 grid grid-cols-2 gap-2">
            <input type="date" name="occurred_on" required className={inputCls} aria-label="Date" />
            <input
              name="amount"
              type="number"
              step="0.01"
              placeholder="Amount"
              required
              className={inputCls}
              aria-label="Amount"
            />
            <select name="category" className={inputCls} aria-label="Category" defaultValue="marketing">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input name="campaign" placeholder="Channel / campaign (optional)" className={inputCls} aria-label="Campaign" />
            <input
              name="description"
              placeholder="Description (optional)"
              className={`${inputCls} col-span-2`}
              aria-label="Description"
            />
            <button
              type="submit"
              className="col-span-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Add expense
            </button>
          </form>
          <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto text-sm">
            {costEntries.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <span className="text-gray-700">
                  {e.occurred_on} · {e.description || e.campaign || e.category}
                  {e.source === 'auto' && <span className="ml-1 text-xs text-gray-400">(auto)</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{money(e.amount, e.currency)}</span>
                  {e.source !== 'auto' && (
                    <form action={deleteCostEntryAction.bind(null, e.id)}>
                      <button type="submit" className="text-xs text-gray-400 hover:text-red-600">
                        remove
                      </button>
                    </form>
                  )}
                </span>
              </li>
            ))}
            {costEntries.length === 0 && <li className="py-2 text-gray-400">No expenses logged yet.</li>}
          </ul>
        </section>

        {/* ── Subscriptions ──────────────────────────── */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Subscriptions</h2>
          <p className="mb-3 text-xs text-gray-500">
            Recurring tools. Each is booked monthly from its start date; editing an amount fixes history.
          </p>
          <form action={addRecurringCostAction} className="mb-4 grid grid-cols-2 gap-2">
            <input name="name" placeholder="Name" required className={inputCls} aria-label="Name" />
            <input
              name="monthly_amount"
              type="number"
              step="0.01"
              placeholder="Monthly amount"
              required
              className={inputCls}
              aria-label="Monthly amount"
            />
            <select name="category" className={inputCls} aria-label="Category" defaultValue="tools_other">
              {SUBSCRIPTION_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input type="date" name="active_from" required className={inputCls} aria-label="Active from" />
            <button
              type="submit"
              className="col-span-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Add subscription
            </button>
          </form>
          <ul className="divide-y divide-gray-100 text-sm">
            {recurring.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-gray-700">
                  {r.name}
                  <span className="ml-1 text-xs text-gray-400">
                    from {r.active_from}
                    {r.active_to ? ` to ${r.active_to}` : ''}
                  </span>
                </span>
                <form action={updateRecurringCostAction.bind(null, r.id)} className="flex items-center gap-2">
                  <input
                    name="monthly_amount"
                    type="number"
                    step="0.01"
                    defaultValue={r.monthly_amount}
                    className="w-20 rounded border border-gray-200 px-2 py-1 text-right text-sm"
                    aria-label={`${r.name} monthly amount`}
                  />
                  <span className="text-xs text-gray-400">/mo</span>
                  <button type="submit" className="text-xs text-gray-400 hover:text-gray-900">
                    save
                  </button>
                  <button
                    formAction={deleteRecurringCostAction.bind(null, r.id)}
                    type="submit"
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    remove
                  </button>
                </form>
              </li>
            ))}
            {recurring.length === 0 && <li className="py-2 text-gray-400">No subscriptions yet.</li>}
          </ul>
        </section>
      </div>

      {/* ── Finance settings ──────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Cost & fee settings</h2>
        <p className="mb-4 text-xs text-gray-500">
          Drives the margin math. Changing a rate re-derives all history — nothing is stored on the orders. FX is a
          last-resort fallback only; the P&L uses daily ECB rates.
        </p>
        <form action={saveFinanceSettingsAction} className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <Field label="Payment fee %" name="payment_fee_percent" defaultValue={settings.payment_fee_percent} />
          <Field label="Payment fixed fee" name="payment_fee_fixed" defaultValue={settings.payment_fee_fixed} />
          <Field label="Output VAT % (fallback)" name="default_vat_percent" defaultValue={settings.default_vat_percent} />
          <Field
            label="FX USD→EUR (fallback)"
            name="creation_fx_usd_to_eur"
            defaultValue={settings.creation_fx_usd_to_eur}
            step="0.0001"
          />
          <Field
            label="Community flat fee default"
            name="default_community_artist_fee"
            defaultValue={settings.default_community_artist_fee}
          />
          <Field
            label="Community royalty % (fallback)"
            name="default_community_royalty_percent"
            defaultValue={settings.default_community_royalty_percent}
            step="0.1"
          />
          <div>
            <label className="mb-1 block text-xs text-gray-500">Reporting currency</label>
            <input name="reporting_currency" defaultValue={settings.reporting_currency} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Gelato input VAT</label>
            <select
              name="input_vat_reclaimable"
              defaultValue={settings.input_vat_reclaimable ? 'true' : 'false'}
              className={inputCls}
            >
              <option value="false">Not reclaimable — counts as cost</option>
              <option value="true">Reclaimable (VAT-registered)</option>
            </select>
          </div>
          <div className="col-span-2 flex items-end lg:col-span-4">
            <button
              type="submit"
              className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Save settings
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none';

function Field({
  label,
  name,
  defaultValue,
  step = '0.01',
}: {
  label: string;
  name: string;
  defaultValue: number;
  step?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <input name={name} type="number" step={step} defaultValue={defaultValue} className={inputCls} />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  emphatic,
}: {
  label: string;
  value: string;
  sub?: string;
  emphatic?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        emphatic ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white'
      }`}
    >
      <p className={`text-xs ${emphatic ? 'text-gray-300' : 'text-gray-500'}`}>{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
