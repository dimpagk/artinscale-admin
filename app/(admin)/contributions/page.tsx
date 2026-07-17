import { getAllContributions, getContributionStats } from '@/lib/contributions';
import { getAllTopics } from '@/lib/topics';
import { PageHeader } from '@/components/admin-ui';
import { ContributionsFilter } from '@/components/contributions/contributions-filter';
import { ContributionMetrics } from '@/components/contributions/contribution-metrics';
import { ContributionsList } from '@/components/contributions/contributions-list';
import type { ContributionStatus, ContributionType } from '@/lib/types';

export default async function ContributionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    topic_id?: string;
    type?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const filters = {
    status: (params.status || undefined) as ContributionStatus | undefined,
    topic_id: params.topic_id || undefined,
    type: (params.type || undefined) as ContributionType | undefined,
    sort: params.sort || undefined,
  };

  const [contributions, stats, topics] = await Promise.all([
    getAllContributions(filters),
    getContributionStats(),
    getAllTopics(),
  ]);

  const topicOptions = topics.map((t) => ({ value: t.id, label: t.title }));

  return (
    <div className="space-y-6">
      <PageHeader title="Contributions" />

      <ContributionMetrics stats={stats} />

      <ContributionsFilter
        currentStatus={filters.status}
        currentTopicId={filters.topic_id}
        currentType={filters.type}
        currentSort={filters.sort}
        topics={topicOptions}
        stats={stats}
      />

      <ContributionsList contributions={contributions} />
    </div>
  );
}
