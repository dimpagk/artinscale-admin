import { PageHeader } from '@/components/admin-ui';
import {
  getPrintSizePricing,
  getPricingFinance,
  getCampaigns,
  findActiveCampaign,
  netMarginPct,
  type PrintSizePrice,
  type PricingFinance,
  type PricingCampaign,
} from '@/lib/pricing';
import {
  updatePriceAction,
  createCampaignAction,
  applyCampaignAction,
  revertCampaignAction,
} from './actions';

// Classics pricing is operator-editable and margin-aware; never cache it.
export const dynamic = 'force-dynamic';

function marginColor(pct: number | null): string {
  if (pct == null) return 'text-gray-400';
  if (pct >= 30) return 'text-green-700';
  if (pct >= 15) return 'text-amber-700';
  return 'text-red-700';
}

function fmtPct(pct: number | null): string {
  return pct == null ? '—' : `${pct.toFixed(0)}%`;
}

export default async function PricingPage() {
  const [{ rows, source }, finance, campaigns] = await Promise.all([
    getPrintSizePricing(),
    getPricingFinance(),
    getCampaigns(),
  ]);
  const active = findActiveCampaign(campaigns);

  return (
    <div>
      <PageHeader
        title="Pricing"
        description="Classics (public-domain print) prices. One row per ship size — edit a price and it applies to new pieces and reprices existing listings. Originals are priced per piece in Shopify and reviewed separately."
      />

      {active && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <strong>Sale live:</strong> “{active.name}” — {active.discount_percent}% off all
          classics. Prices below are the pre-sale base; Shopify shows the discounted price with a
          strikethrough. Revert it in the campaigns panel to end the sale.
        </div>
      )}

      {source === 'fallback' && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Migration 032 not applied.</strong> Showing built-in default
          prices. Run <code className="rounded bg-amber-100 px-1">sql/032_pricing.sql</code>{' '}
          in the Supabase SQL editor to enable saving. (Live Shopify listings
          still reprice on save; only DB persistence needs the migration.)
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1">
          Margin assumes VAT {finance.vatPercent}% · payment fee{' '}
          {finance.paymentFeePercent}% + €{finance.paymentFeeFixed.toFixed(2)}
        </span>
        <span className="text-gray-400">
          {finance.source === 'finance_settings'
            ? 'from finance settings'
            : 'defaults — configure in Economics once cost tracking is live'}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Size</th>
              <th className="px-4 py-3 font-medium">Est. cost</th>
              <th className="px-4 py-3 font-medium">Price (€)</th>
              <th className="px-4 py-3 font-medium">Net margin</th>
              <th className="px-4 py-3 font-medium">−10%</th>
              <th className="px-4 py-3 font-medium">−20%</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <PricingRow key={r.size_key} row={r} finance={finance} />
            ))}
          </tbody>
        </table>
      </div>

      <CampaignPanel campaigns={campaigns} hasActive={!!active} />
    </div>
  );
}

function CampaignPanel({
  campaigns,
  hasActive,
}: {
  campaigns: PricingCampaign[];
  hasActive: boolean;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-1 text-base font-semibold text-gray-900">Discount campaigns</h2>
      <p className="mb-4 text-sm text-gray-500">
        A campaign discounts every classics listing by a percentage via Shopify’s
        compare-at-price (the “was €X” strikethrough). Only one can be live at a time.
      </p>

      {/* Create */}
      <form
        action={createCampaignAction}
        className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Campaign name
          <input
            type="text"
            name="name"
            required
            placeholder="Summer sale"
            className="w-56 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Discount %
          <input
            type="number"
            name="discount_percent"
            required
            min="1"
            max="99"
            step="1"
            placeholder="20"
            className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-gray-900 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100"
        >
          Create draft
        </button>
      </form>

      {/* List */}
      {campaigns.length === 0 ? (
        <p className="text-sm text-gray-400">No campaigns yet.</p>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {c.name}{' '}
                  <span className="text-gray-500">· {c.discount_percent}% off classics</span>
                </p>
                <p className="text-xs text-gray-400">
                  <CampaignStatus status={c.status} />
                  {c.applied_at && c.status === 'active' ? ` · applied` : ''}
                  {c.reverted_at && c.status === 'ended' ? ` · ended` : ''}
                </p>
              </div>
              <div className="shrink-0">
                {c.status === 'draft' && (
                  <form action={applyCampaignAction}>
                    <input type="hidden" name="campaign_id" value={c.id} />
                    <button
                      type="submit"
                      disabled={hasActive}
                      title={hasActive ? 'Revert the live sale first' : ''}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </form>
                )}
                {c.status === 'active' && (
                  <form action={revertCampaignAction}>
                    <input type="hidden" name="campaign_id" value={c.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Revert
                    </button>
                  </form>
                )}
                {c.status === 'ended' && <span className="text-xs text-gray-400">closed</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CampaignStatus({ status }: { status: PricingCampaign['status'] }) {
  const map: Record<PricingCampaign['status'], string> = {
    draft: 'text-gray-500',
    active: 'text-green-700 font-medium',
    ended: 'text-gray-400',
  };
  return <span className={map[status]}>{status}</span>;
}

function PricingRow({ row, finance }: { row: PrintSizePrice; finance: PricingFinance }) {
  const cost = row.gelato_cost_estimate_eur;
  const margin = netMarginPct(row.price_eur, cost, finance);
  const margin10 = netMarginPct(row.price_eur * 0.9, cost, finance);
  const margin20 = netMarginPct(row.price_eur * 0.8, cost, finance);

  return (
    <tr className="hover:bg-gray-50/50">
      <td className="px-4 py-3">
        <span className="font-medium text-gray-900">{row.display_name}</span>
        {!row.active && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
      </td>
      <td className="px-4 py-3 text-gray-600">
        {cost == null ? (
          '—'
        ) : (
          <span className="inline-flex items-center gap-1.5">
            €{cost.toFixed(2)}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                row.cost_source === 'actual'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {row.cost_source === 'actual' ? 'actual' : 'est'}
            </span>
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <form action={updatePriceAction} className="flex items-center gap-2">
          <input type="hidden" name="size_key" value={row.size_key} />
          <input type="hidden" name="display_name" value={row.display_name} />
          <input type="hidden" name="width_cm" value={row.width_cm} />
          <input type="hidden" name="height_cm" value={row.height_cm} />
          <input
            type="number"
            name="price"
            step="0.01"
            min="0"
            defaultValue={row.price_eur.toFixed(2)}
            className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-gray-900 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700"
          >
            Save
          </button>
        </form>
      </td>
      <td className={`px-4 py-3 font-semibold tabular-nums ${marginColor(margin)}`}>
        {fmtPct(margin)}
      </td>
      <td className={`px-4 py-3 tabular-nums ${marginColor(margin10)}`}>{fmtPct(margin10)}</td>
      <td className={`px-4 py-3 tabular-nums ${marginColor(margin20)}`}>{fmtPct(margin20)}</td>
      <td className="px-4 py-3 text-right text-xs text-gray-400">
        {row.cost_source === 'estimated' ? 'cost estimated' : ''}
      </td>
    </tr>
  );
}
