import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn, SectionLabel } from '@/components/admin-ui';
import {
  getMarketBidCaps,
  bidCapsGeneratedAt,
  type MarketBidCap,
} from '@/lib/costs/bid-caps';

// The fraction of contribution we're willing to spend acquiring an order.
// Mirrors DEFAULT_TARGET_CAC_RATIO; surfaced here for the copy only.
const TARGET_RATIO_PCT = 60;

const eur = (n: number) => `€${n.toFixed(2)}`;

const TIER_BADGE: Record<MarketBidCap['tier'], { label: string; variant: 'success' | 'warning' }> = {
  A: { label: 'cheap', variant: 'success' },
  B: { label: 'expensive', variant: 'warning' },
};

const columns: DataTableColumn<MarketBidCap>[] = [
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
    render: (r) => <Badge variant={TIER_BADGE[r.tier].variant}>{TIER_BADGE[r.tier].label}</Badge>,
  },
  {
    key: 'contribution',
    header: 'Hero contrib.',
    align: 'right',
    render: (r) => <span className="tabular-nums text-gray-600">{eur(r.heroContribution)}</span>,
  },
  {
    key: 'heroCap',
    header: 'Hero cap',
    align: 'right',
    render: (r) => <span className="tabular-nums font-semibold text-gray-900">{eur(r.heroCap)}</span>,
  },
  {
    key: 'largeCap',
    header: '50×70 cap',
    align: 'right',
    render: (r) => <span className="tabular-nums text-gray-900">{eur(r.largeCap)}</span>,
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

export function BidCapsSection() {
  const rows = getMarketBidCaps();
  const generatedAt = bidCapsGeneratedAt().slice(0, 10);

  return (
    <section className="space-y-3">
      <SectionLabel>Bid caps by market</SectionLabel>
      <p className="max-w-2xl text-sm text-gray-500">
        Pricing is flat across every country, but Gelato&rsquo;s landed cost is
        destination-tiered, so the acquisition budget per order has to differ by
        market. These are the <strong>cost caps</strong> (max CPA) to enter on
        each market&rsquo;s Meta ad set, set at {TARGET_RATIO_PCT}% of
        contribution so ~40% stays as profit. The lever under flat pricing is the
        lead format, not the price: in expensive markets the hero cap is thin, so
        lead the ad set with the 50×70 format to work off the higher cap.
      </p>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.country} />
      <p className="text-xs text-gray-400">
        Landed-cost snapshot {generatedAt}. Leave ad sets uncapped during the
        initial learning phase (per the test plan); apply these caps when moving
        to cost-capped scaling. Refresh with{' '}
        <code>node scripts/gelato-country-costs.mjs --write</code>.
      </p>
    </section>
  );
}
