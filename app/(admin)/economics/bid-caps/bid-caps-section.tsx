import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn, SectionLabel, StatCard } from '@/components/admin-ui';
import type { MarketPerfRow, PerEuroSummary, SizeCapRow } from '@/lib/costs/bid-caps';

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

// museum-poster-50x70 → 50×70
const sizeLabel = (key: string) => key.replace(/^museum-poster-/, '').replace('x', '×');

const TIER_BADGE: Record<'A' | 'B', { label: string; variant: 'success' | 'warning' }> = {
  A: { label: 'cheap', variant: 'success' },
  B: { label: 'expensive', variant: 'warning' },
};

const VERDICT: Record<
  MarketPerfRow['verdict'],
  { label: string; variant: 'success' | 'warning' | 'error' | 'secondary' } | null
> = {
  under: { label: 'under cap', variant: 'success' },
  watch: { label: 'near cap', variant: 'warning' },
  over: { label: 'over cap', variant: 'error' },
  'no-orders': { label: 'no orders', variant: 'error' },
  'no-data': null,
};

interface BidCapsSectionProps {
  perEuro: PerEuroSummary | null;
  perfRows: MarketPerfRow[];
  sizeRows: SizeCapRow[];
  generatedAt: string;
  pieceCount: number;
  sizesUsed: string[];
  metaConfigured: boolean;
  metaError?: string;
  windowDays: number;
  currency: string;
}

export function BidCapsSection({
  perEuro,
  perfRows,
  sizeRows,
  generatedAt,
  pieceCount,
  sizesUsed,
  metaConfigured,
  metaError,
  windowDays,
  currency,
}: BidCapsSectionProps) {
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const eur = (n: number) => `€${n.toFixed(2)}`;
  const money = (n: number | null) => (n == null ? '—' : `${sym}${n.toFixed(2)}`);
  const sizes = sizesUsed.map(sizeLabel).join(', ') || '—';

  const perfColumns: DataTableColumn<MarketPerfRow>[] = [
    {
      key: 'market',
      header: 'Market',
      render: (r) => (
        <span className="font-medium text-gray-900">
          {r.name} <span className="text-gray-400">{r.country}</span>
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Fulfilment',
      render: (r) =>
        r.tier ? <Badge variant={TIER_BADGE[r.tier].variant}>{TIER_BADGE[r.tier].label}</Badge> : <span className="text-gray-400">—</span>,
    },
    {
      key: 'vat',
      header: 'VAT',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums text-gray-500">
          {r.vatPercent > 0 ? `${r.vatPercent}%` : '0% (export)'}
        </span>
      ),
    },
    {
      key: 'cap',
      header: 'CAC cap',
      align: 'right',
      render: (r) => <span className="tabular-nums font-semibold text-gray-900">{eur(r.cap)}</span>,
    },
    {
      key: 'spend',
      header: 'Spend',
      align: 'right',
      render: (r) => <span className="tabular-nums text-gray-600">{money(r.spend)}</span>,
    },
    {
      key: 'metaCac',
      header: 'Meta CAC',
      align: 'right',
      render: (r) => <span className="tabular-nums text-gray-900">{money(r.metaCac)}</span>,
    },
    {
      key: 'blendedCac',
      header: 'Blended CAC',
      align: 'right',
      render: (r) => <span className="tabular-nums text-gray-600">{money(r.blendedCac)}</span>,
    },
    {
      key: 'orders',
      header: 'Orders (M / S)',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums text-gray-500">
          {r.metaOrders ?? '—'} / {r.shopifyOrders ?? '—'}
        </span>
      ),
    },
    {
      key: 'roas',
      header: 'ROAS',
      align: 'right',
      render: (r) => <span className="tabular-nums text-gray-500">{r.metaRoas == null ? '—' : `${r.metaRoas.toFixed(1)}×`}</span>,
    },
    {
      key: 'verdict',
      header: 'Status',
      render: (r) => {
        const v = VERDICT[r.verdict];
        return v ? <Badge variant={v.variant}>{v.label}</Badge> : <span className="text-gray-400">no spend</span>;
      },
    },
  ];

  const sizeColumns: DataTableColumn<SizeCapRow>[] = [
    { key: 'size', header: 'Size', render: (r) => <span className="font-medium text-gray-900">{r.label}</span> },
    { key: 'price', header: 'Live price', align: 'right', render: (r) => <span className="tabular-nums text-gray-700">{eur(r.price)}</span> },
    {
      key: 'landed',
      header: 'Landed (cheapest → dearest)',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums text-gray-600">
          {eur(r.landedCheapest)} <span className="text-gray-400">{r.cheapestCountry}</span>
          {' → '}
          {eur(r.landedDearest)} <span className="text-gray-400">{r.dearestCountry}</span>
        </span>
      ),
    },
    {
      key: 'cap',
      header: 'Cap (best → worst market)',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums font-semibold text-gray-900">
          {eur(r.capCheapest)} → {eur(r.capDearest)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      {perEuro && (
        <section className="space-y-3">
          <SectionLabel>Per €1 at the caps (blended)</SectionLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Target max CAC (blended)"
              value={`€${perEuro.blendedCap.toFixed(2)}`}
              description={`Simple mean across ${perEuro.markets} markets; bid per market, not the blend`}
            />
            <StatCard
              label="€1 of ads → revenue"
              value={`${perEuro.roas.toFixed(1)}×`}
              description="Gross order value ÷ CAC at cap (Meta ROAS view)"
            />
            <StatCard
              label="€1 of total spend → revenue"
              value={`€${perEuro.revenuePerEuroLoaded.toFixed(2)}`}
              description={`Net revenue per €1 of all cash out · €${perEuro.revenuePerEuro.toFixed(2)} if creation is sunk`}
            />
            <StatCard
              label="€1 of total spend → EBITDA"
              value={`€${perEuro.roiLoaded.toFixed(2)}`}
              valueColorClass={perEuro.roiLoaded >= 0 ? 'text-green-700' : 'text-red-700'}
              description={`€${perEuro.ebitdaPerOrderLoaded.toFixed(2)}/order · creation €${perEuro.creationPerOrder.toFixed(2)}/order at ${perEuro.amortUnits} lifetime sales; subscriptions not included yet`}
            />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionLabel>CAC by market: cap vs actual</SectionLabel>
        <p className="max-w-2xl text-sm text-gray-500">
          The cost cap (max CPA) to enter on each market&rsquo;s Meta ad set, set
          at 60% of contribution so ~40% stays as profit. Contribution is{' '}
          <strong>net of output VAT</strong> (EU sales carry the Greek home rate;
          exports are zero-rated), the <strong>sales-weighted</strong> average
          over the {pieceCount} listed pieces (sizes {sizes}) at their live
          prices. <strong>Meta CAC</strong>{' '}
          = spend ÷ Meta-attributed purchases; <strong>Blended CAC</strong> ={' '}
          spend ÷ all Shopify orders to the country. Last {windowDays} days.
        </p>

        {!metaConfigured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>Meta not connected.</strong> Set{' '}
            <code className="rounded bg-amber-100 px-1">META_AD_ACCOUNT_ID</code>{' '}
            and{' '}
            <code className="rounded bg-amber-100 px-1">META_ADS_ACCESS_TOKEN</code>{' '}
            to populate spend, Meta CAC and ROAS. Caps and Shopify orders below
            are live.
          </div>
        )}
        {metaConfigured && metaError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>Meta API error:</strong> {metaError}
          </div>
        )}

        {perfRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center text-sm text-gray-500">
            No listed pieces with a print size and price yet.
          </p>
        ) : (
          <DataTable rows={perfRows} columns={perfColumns} rowKey={(r) => r.country} />
        )}

        <p className="text-xs text-gray-400">
          Caps are sales-weighted by units sold (with light smoothing while
          volume is low). Actual CAC is Meta-attributed, an operational
          signal, not audited incrementality. Landed-cost snapshot {generatedAt};
          refresh with <code>node scripts/gelato-country-costs.mjs --write</code>.
        </p>
      </section>

      <section className="space-y-3">
        <SectionLabel>Per-size reference (live prices)</SectionLabel>
        <p className="max-w-2xl text-sm text-gray-500">
          Every size at its current <code>print_size_pricing</code> price, with
          the cheapest and dearest market cap. Useful for classics (customer
          picks the size). Caps track price edits automatically.
        </p>
        <DataTable rows={sizeRows} columns={sizeColumns} rowKey={(r) => r.sizeKey} />
      </section>
    </div>
  );
}
