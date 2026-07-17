import { getListedPrintPieces } from '@/lib/pricing';
import { getFinanceSettings } from '@/lib/costs/economics';
import { getPerEuroSummary } from '@/lib/costs/bid-caps';
import { SectionLabel } from '@/components/admin-ui';

// KPI reference: what each metric means and which numbers decide push/pull/
// kill. Mirrors docs/KPIS.md; the live figures live on the Bid caps tab.
export const dynamic = 'force-dynamic';

interface KpiRow {
  kpi: string;
  target: string;
  why: string;
  where: string;
}

const PRIMARY: KpiRow[] = [
  {
    kpi: 'Blended CAC vs cap (per market, 4-week rolling)',
    target: 'Under the per-market cap; blended roughly EUR 25',
    why: 'The number the whole model exists to control',
    where: 'Bid caps tab, Status column',
  },
  {
    kpi: 'Site conversion rate (sessions to orders)',
    target: '>= 1.5% (>= 1.0% tolerable while learning)',
    why: 'The binding constraint: below ~1% no bid strategy works',
    where: 'GA4 / Shopify Analytics',
  },
  {
    kpi: 'Orders per week',
    target: 'Learning: 3-5/week. Post-test: 15+/month',
    why: 'Validates demand; only volume dilutes creation + fixed costs',
    where: 'Shopify / Economics overview',
  },
  {
    kpi: 'Contribution profit per week (EUR)',
    target: '> 0 by week 4, then growing',
    why: 'The absolute-euros check that ratios cannot fake',
    where: 'Economics P&L + Bid caps tab',
  },
];

const GATES: Array<{ result: string; verdict: string; action: string }> = [
  {
    result: 'Blended CAC under cap AND >= 5 orders',
    verdict: 'Paid works',
    action: 'Scale +20%/week; grow catalog in parallel',
  },
  {
    result: 'CAC between 1x and 2x the cap',
    verdict: 'Close',
    action: 'Hold budget; iterate creative + PDP; one more gate',
  },
  {
    result: 'CAC over 2x cap, or under 3 orders',
    verdict: 'Not ready',
    action: 'Pause paid; fix funnel or catalog; retest in 6-8 weeks',
  },
  {
    result: 'Spend but zero orders',
    verdict: 'Too early',
    action: 'Pause; treat as a CVR problem, not an ads problem',
  },
];

const SECONDARY: Array<{ group: string; items: string[] }> = [
  {
    group: 'Ad efficiency (explains KPI 1)',
    items: [
      'Per-market Meta CAC vs cap: which geos break the blend; act per row',
      'ROAS by market vs target (US ~2.3x, DE ~3.6x, blended ~4.1x at cap)',
      'CPM and CTR by creative: splits high CAC into targeting vs creative vs site',
      'Meta CAC vs Blended CAC divergence: attribution health; trust blended',
    ],
  },
  {
    group: 'Funnel (explains KPI 2)',
    items: [
      'PDP view to add-to-cart rate (target ~5-8%)',
      'Checkout completion (target >= 40%); known mobile checkout-toast issue lives here',
      'Purchase-event health: Meta purchases should match Shopify orders',
    ],
  },
  {
    group: 'Economics (explains KPI 4)',
    items: [
      'AOV and size mix (baseline ~EUR 71); tier-B orders should skew to large formats',
      'Units sold per piece vs the 10-lifetime-sales amortisation assumption',
      'EBITDA per EUR 1 tile (loaded): should hold or improve with volume',
    ],
  },
  {
    group: 'Supply and experience (monthly)',
    items: [
      'Listed catalog size (paid traffic wants 20-30+ pieces)',
      'Delivery time and refund rate per tier (slow Greece delivery feeds back into CVR)',
    ],
  },
];

const METRIC_FLOW: Array<{ line: string; note: string; result?: boolean }> = [
  { line: 'gross price', note: 'what the customer pays (flat across countries, VAT-inclusive)' },
  { line: '- output VAT', note: 'EU B2C: Greek 24% under the <EUR 10k regime; UK 20%; exports 0%' },
  { line: '= net revenue', note: 'what we keep of the price', result: true },
  { line: '- Gelato landed cost', note: 'production + shipping, tiered by destination country' },
  { line: '- payment fee', note: '1.9% + EUR 0.25' },
  { line: '- artist royalty', note: 'community pieces only (rates unset today, so 0%)' },
  { line: '= CONTRIBUTION', note: 'what one sale earns before marketing', result: true },
  { line: '- CAC', note: 'what we paid Meta to acquire the order (cap = 60% of contribution)' },
  { line: '= marginal profit', note: 'per-order profit before overhead', result: true },
  { line: '- creation amortised', note: 'one-time piece cost over assumed 10 lifetime sales' },
  { line: '- opex per order', note: 'subscriptions / orders (not wired in yet)' },
  { line: '= EBITDA per order', note: 'true operating profit per order', result: true },
];

export default async function KpisPage() {
  const [pieces, finance] = await Promise.all([
    getListedPrintPieces(),
    getFinanceSettings(),
  ]);
  const perEuro = getPerEuroSummary(pieces, {
    weighted: true,
    homeVatPercent: finance.default_vat_percent,
  });

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <SectionLabel>How one order&rsquo;s euro flows</SectionLabel>
        <p className="max-w-2xl text-sm text-gray-500">
          Every metric on the Bid caps tab is a stop on this waterfall.
          Contribution is computed per destination country because Gelato prices
          production and shipping in destination tiers. Under flat pricing the
          levers are the per-market cap and the lead format, never geo pricing.
        </p>
        <div className="max-w-2xl overflow-hidden rounded-lg border border-gray-200">
          {METRIC_FLOW.map((row) => (
            <div
              key={row.line}
              className={`flex items-baseline gap-4 px-4 py-1.5 text-sm ${
                row.result ? 'bg-gray-50 font-medium text-gray-900' : 'text-gray-600'
              }`}
            >
              <span className="w-44 shrink-0 font-mono text-xs">{row.line}</span>
              <span className="text-xs text-gray-500">{row.note}</span>
            </div>
          ))}
        </div>
        <p className="max-w-2xl text-xs text-gray-400">
          Two structural facts: the expensive-tier penalty is a fixed ~EUR 5-6
          per order (crushes cheap products, barely dents large formats), and
          ratios flatter the worst markets (high required ROAS means LOW budget
          capacity, not opportunity). Allocate budget by absolute contribution
          headroom.
        </p>
      </section>

      <section className="space-y-3">
        <SectionLabel>Primary KPIs (weekly, decide push / pull / kill)</SectionLabel>
        <p className="max-w-2xl text-sm text-gray-500">
          Reviewed Mondays on 4-week rolling windows. Never react to daily
          numbers: every gate below is a 4-week number.
          {perEuro && (
            <>
              {' '}Current blended cap: <strong>€{perEuro.blendedCap.toFixed(2)}</strong>{' '}
              (ROAS at cap {perEuro.roas.toFixed(1)}×); per-market caps are on
              the Bid caps tab.
            </>
          )}
        </p>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">KPI</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Why primary</th>
                <th className="px-4 py-3 font-medium">Where</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {PRIMARY.map((r, i) => (
                <tr key={r.kpi} className="align-top hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {i + 1}. {r.kpi}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.target}</td>
                  <td className="px-4 py-3 text-gray-500">{r.why}</td>
                  <td className="px-4 py-3 text-gray-500">{r.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Gate logic (4-week windows)</SectionLabel>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">4-week result</th>
                <th className="px-4 py-3 font-medium">Verdict</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {GATES.map((g) => (
                <tr key={g.result} className="align-top hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-900">{g.result}</td>
                  <td className="px-4 py-3 font-medium text-gray-700">{g.verdict}</td>
                  <td className="px-4 py-3 text-gray-500">{g.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Secondary KPIs (diagnostics)</SectionLabel>
        <p className="max-w-2xl text-sm text-gray-500">
          Check only when a primary is off; each group explains one primary.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {SECONDARY.map((s) => (
            <div key={s.group} className="rounded-lg border border-gray-200 p-4">
              <p className="mb-2 text-sm font-medium text-gray-900">{s.group}</p>
              <ul className="space-y-1.5 text-sm text-gray-500">
                {s.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-gray-300">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="max-w-2xl text-xs text-gray-400">
          Full reference with the anti-patterns and snapshot values:
          docs/KPIS.md in the repo. Reading &ldquo;under cap&rdquo; as
          &ldquo;profitable&rdquo; is the classic trap: the cap keeps 40% of
          contribution, which still must cover creation amortisation and fixed
          costs. Only volume makes the loaded number positive.
        </p>
      </section>
    </div>
  );
}
