import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn, SectionLabel } from '@/components/admin-ui';
import type { MarketCap, SizeCapRow } from '@/lib/costs/bid-caps';

const eur = (n: number) => `€${n.toFixed(2)}`;

// museum-poster-50x70 → 50×70
const sizeLabel = (key: string) => key.replace(/^museum-poster-/, '').replace('x', '×');

const TIER_BADGE: Record<'A' | 'B', { label: string; variant: 'success' | 'warning' }> = {
  A: { label: 'cheap', variant: 'success' },
  B: { label: 'expensive', variant: 'warning' },
};

function tierCell(tier: MarketCap['tier']) {
  if (!tier) return <span className="text-gray-400">—</span>;
  const b = TIER_BADGE[tier];
  return <Badge variant={b.variant}>{b.label}</Badge>;
}

const catalogColumns: DataTableColumn<MarketCap>[] = [
  {
    key: 'market',
    header: 'Market',
    render: (r) => (
      <span className="font-medium text-gray-900">
        {r.name} <span className="text-gray-400">{r.country}</span>
      </span>
    ),
  },
  { key: 'tier', header: 'Fulfilment', render: (r) => tierCell(r.tier) },
  {
    key: 'contrib',
    header: 'Avg contribution',
    align: 'right',
    render: (r) => <span className="tabular-nums text-gray-600">{eur(r.avgContribution)}</span>,
  },
  {
    key: 'cap',
    header: 'CAC cap',
    align: 'right',
    render: (r) => <span className="tabular-nums font-semibold text-gray-900">{eur(r.cap)}</span>,
  },
  {
    key: 'delivery',
    header: 'Delivery',
    align: 'right',
    render: (r) => <span className="tabular-nums text-gray-500">{r.deliveryDays}d</span>,
  },
  {
    key: 'guidance',
    header: 'Guidance',
    width: 'min-w-[240px]',
    render: (r) => <span className="text-gray-500">{r.guidance}</span>,
  },
];

const sizeColumns: DataTableColumn<SizeCapRow>[] = [
  {
    key: 'size',
    header: 'Size',
    render: (r) => <span className="font-medium text-gray-900">{r.label}</span>,
  },
  {
    key: 'price',
    header: 'Live price',
    align: 'right',
    render: (r) => <span className="tabular-nums text-gray-700">{eur(r.price)}</span>,
  },
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

interface BidCapsSectionProps {
  catalogRows: MarketCap[];
  sizeRows: SizeCapRow[];
  generatedAt: string;
  pieceCount: number;
  sizesUsed: string[];
}

export function BidCapsSection({
  catalogRows,
  sizeRows,
  generatedAt,
  pieceCount,
  sizesUsed,
}: BidCapsSectionProps) {
  const sizes = sizesUsed.map(sizeLabel).join(', ') || '—';

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionLabel>Allowable CAC by market</SectionLabel>
        <p className="max-w-2xl text-sm text-gray-500">
          The cost cap (max CPA) to enter on each market&rsquo;s Meta ad set,
          set at 60% of contribution so ~40% stays as profit. Contribution is
          averaged over the <strong>{pieceCount} listed pieces</strong> (sizes{' '}
          {sizes}) at their live prices, so it reflects what&rsquo;s actually for
          sale — not an abstract entry size. Pricing is flat across countries;
          the lever is the cap and the lead format.
        </p>
        {catalogRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center text-sm text-gray-500">
            No listed pieces with a print size and price yet.
          </p>
        ) : (
          <DataTable rows={catalogRows} columns={catalogColumns} rowKey={(r) => r.country} />
        )}
        <p className="text-xs text-gray-400">
          Unweighted mean across listed pieces. Future: weight by units sold per
          item. Landed-cost snapshot {generatedAt}; refresh with{' '}
          <code>node scripts/gelato-country-costs.mjs --write</code>.
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
