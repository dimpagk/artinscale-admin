import { PageHeader } from '@/components/admin-ui';
import {
  getPnlSummary,
  getArtworkEconomics,
  getMarketingSpend,
  getFinanceSettings,
} from '@/lib/costs/economics';
import {
  saveFinanceSettingsAction,
  addMarketingSpendAction,
  deleteMarketingSpendAction,
} from './actions';

function money(amount: number | null | undefined, currency = 'EUR'): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
}

export default async function EconomicsPage() {
  const [pnl, artworks, marketing, settings] = await Promise.all([
    getPnlSummary(),
    getArtworkEconomics(),
    getMarketingSpend(),
    getFinanceSettings(),
  ]);
  const cur = pnl.reportingCurrency;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unit economics"
        description="Costs and contribution margin across the catalog. Creation cost is one-time per piece and amortised over every unit it sells; production, fees, VAT and discounts are per-order; marketing is blended."
      />

      {/* ── P&L summary ─────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross revenue" value={money(pnl.grossRevenue, cur)} sub={`${pnl.orderCount} orders · ${pnl.unitsSold} units`} />
        <Stat label="Contribution margin" value={money(pnl.contributionMargin, cur)} sub="after production, shipping, fees" />
        <Stat label="Creation cost (sold pieces)" value={money(pnl.creationCostRealized, cur)} sub="one-time, realised" />
        <Stat
          label="Net after creation + marketing"
          value={money(pnl.netAfterCreationAndMarketing, cur)}
          sub={pnl.marketingCac != null ? `blended CAC ${money(pnl.marketingCac, cur)}` : 'excl. fixed costs'}
          emphatic
        />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Cost stack</h2>
        <dl className="space-y-1 text-sm">
          <Row label="Gross revenue" value={money(pnl.grossRevenue, cur)} />
          <Row label="− Discounts" value={`- ${money(pnl.discounts, cur)}`} muted />
          <Row label="+ Shipping charged" value={money(pnl.shippingCharged, cur)} muted />
          <Row label="− Production (Gelato)" value={`- ${money(pnl.productionCost, cur)}`} muted />
          <Row label="− Gelato shipping" value={`- ${money(pnl.shippingCost, cur)}`} muted />
          <Row label="− Payment fees" value={`- ${money(pnl.paymentFees, cur)}`} muted />
          <Row label="− Artist royalties" value={`- ${money(pnl.artistRoyalties, cur)}`} muted />
          <div className="border-t border-gray-100 pt-1">
            <Row label="Contribution margin" value={money(pnl.contributionMargin, cur)} bold />
          </div>
          <Row label="− Creation cost (sold pieces)" value={`- ${money(pnl.creationCostRealized, cur)}`} muted />
          <Row label="− Marketing" value={`- ${money(pnl.marketingSpend, cur)}`} muted />
          <div className="border-t border-gray-100 pt-1">
            <Row label="Net (excl. fixed costs)" value={money(pnl.netAfterCreationAndMarketing, cur)} bold />
          </div>
        </dl>
      </section>

      {/* ── Per-artwork ─────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Per-artwork economics</h2>
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
                    {a.amortized_creation_per_unit != null ? money(a.amortized_creation_per_unit, a.creation_cost_currency) : '—'}
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
        {/* ── Marketing spend ────────────────────────── */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Marketing spend</h2>
          <form action={addMarketingSpendAction} className="mb-4 grid grid-cols-2 gap-2">
            <input type="date" name="spend_date" required className={inputCls} aria-label="Date" />
            <input name="amount" type="number" step="0.01" placeholder="Amount" required className={inputCls} aria-label="Amount" />
            <select name="channel" className={inputCls} aria-label="Channel" defaultValue="meta">
              <option value="meta">Meta</option>
              <option value="google">Google</option>
              <option value="pinterest">Pinterest</option>
              <option value="other">Other</option>
            </select>
            <input name="campaign" placeholder="Campaign (optional)" className={inputCls} aria-label="Campaign" />
            <button type="submit" className="col-span-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
              Add spend
            </button>
          </form>
          <ul className="divide-y divide-gray-100 text-sm">
            {marketing.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2">
                <span className="text-gray-700">
                  {m.spend_date} · {m.channel}
                  {m.campaign ? ` · ${m.campaign}` : ''}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{money(m.amount, m.currency)}</span>
                  <form action={deleteMarketingSpendAction.bind(null, m.id)}>
                    <button type="submit" className="text-xs text-gray-400 hover:text-red-600">
                      remove
                    </button>
                  </form>
                </span>
              </li>
            ))}
            {marketing.length === 0 && <li className="py-2 text-gray-400">No spend logged yet.</li>}
          </ul>
        </section>

        {/* ── Finance settings ───────────────────────── */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Cost & fee settings</h2>
          <p className="mb-4 text-xs text-gray-500">
            Drives the margin math. Changing a rate re-derives all history — nothing is stored on the orders.
          </p>
          <form action={saveFinanceSettingsAction} className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Payment fee %" name="payment_fee_percent" defaultValue={settings.payment_fee_percent} />
            <Field label="Payment fixed fee" name="payment_fee_fixed" defaultValue={settings.payment_fee_fixed} />
            <Field label="Default VAT %" name="default_vat_percent" defaultValue={settings.default_vat_percent} />
            <Field label="Monthly fixed cost" name="monthly_fixed_cost" defaultValue={settings.monthly_fixed_cost} />
            <Field label="FX USD→EUR" name="creation_fx_usd_to_eur" defaultValue={settings.creation_fx_usd_to_eur} step="0.0001" />
            <Field label="Community flat fee default" name="default_community_artist_fee" defaultValue={settings.default_community_artist_fee} />
            <Field label="Community royalty % (fallback)" name="default_community_royalty_percent" defaultValue={settings.default_community_royalty_percent} step="0.1" />
            <div>
              <label className="mb-1 block text-xs text-gray-500">Reporting currency</label>
              <input name="reporting_currency" defaultValue={settings.reporting_currency} className={inputCls} />
            </div>
            <button type="submit" className="col-span-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
              Save settings
            </button>
          </form>
        </section>
      </div>
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
    <div className={`rounded-xl border p-4 ${emphatic ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white'}`}>
      <p className={`text-xs ${emphatic ? 'text-gray-300' : 'text-gray-500'}`}>{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className={`mt-1 text-xs ${emphatic ? 'text-gray-400' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? 'text-gray-400' : 'text-gray-500'}>{label}</dt>
      <dd className={bold ? 'font-semibold text-gray-900' : muted ? 'text-gray-500' : 'text-gray-700'}>{value}</dd>
    </div>
  );
}
