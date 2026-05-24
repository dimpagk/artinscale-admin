import { getAllContributions, getContributionStats } from '@/lib/contributions';
import { ContributionMetrics } from '@/components/contributions/contribution-metrics';
import { ContributionsList } from '@/components/contributions/contributions-list';
import { TopicContributionsStatusFilter } from '@/components/topics/topic-contributions-status-filter';
import type { ContributionStatus } from '@/lib/types';

export async function TopicContributionsList({
  topicId,
  status,
}: {
  topicId: string;
  status?: ContributionStatus;
}) {
  // Stats are computed unfiltered so the tab counts always reflect the
  // whole topic, not the current view.
  const [contributions, stats] = await Promise.all([
    getAllContributions({ topic_id: topicId, status }),
    getContributionStats({ topic_id: topicId }),
  ]);

  return (
    <div className="space-y-6">
      <ContributionMetrics stats={stats} />
      <TopicContributionsStatusFilter
        topicId={topicId}
        currentStatus={status}
        stats={stats}
      />
      <ContributionsList
        contributions={contributions}
        emptyTitle="No contributions match"
        emptyDescription="Try clearing the status filter or wait for the next round of contributions."
      />
    </div>
  );
}
