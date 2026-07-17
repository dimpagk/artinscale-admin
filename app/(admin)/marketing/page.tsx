import { PageHeader } from '@/components/admin-ui';
import { getAdCreativeGroups, summarize } from '@/lib/ad-creatives';
import { MarketingClient } from './marketing-client';
import { BidCapsSection } from './bid-caps-section';

// Copy is operator-editable; always read fresh.
export const dynamic = 'force-dynamic';

const CAMPAIGN = 'test-2026-07';

export default async function MarketingPage() {
  const groups = await getAdCreativeGroups(CAMPAIGN);
  const stats = summarize(groups);

  const description =
    groups.length === 0
      ? 'No ad copy yet. Apply migration 046, then run scripts/seed-ad-creatives.mjs.'
      : `${stats.total} creatives across ${groups.length} pieces · ${stats.approved} approved, ${stats.draft} draft, ${stats.rejected} rejected`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ad Copy"
        description={description}
        badge={{ label: CAMPAIGN, variant: 'outline' }}
      />
      <p className="max-w-2xl text-sm text-gray-500">
        Paid-ad copy for the Meta test, one card per piece. Review, edit, and
        approve here, then paste the approved copy into Meta Ads Manager. Nothing
        on this page publishes anywhere on its own.
      </p>
      <BidCapsSection />
      <MarketingClient groups={groups} />
    </div>
  );
}
