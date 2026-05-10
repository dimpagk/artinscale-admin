import { notFound } from 'next/navigation';
import { getTopic } from '@/lib/topics';
import { getArtists } from '@/lib/users';
import { TopicForm } from '@/components/topics/topic-form';
import { TopicTabs } from '@/components/topics/topic-tabs';
import { TopicContributionsList } from '@/components/topics/topic-contributions-list';
import { GenerateContributionsButton } from '@/components/topics/generate-contributions-button';
import { TopicTasksStatus } from '@/components/topics/topic-tasks-status';
import {
  BackLink,
  EditPageLayout,
  PageHeader,
  SidebarCard,
} from '@/components/admin-ui';
import type { ContributionStatus } from '@/lib/types';

const STATUS_VALUES = new Set<ContributionStatus>(['pending', 'approved', 'rejected']);

export default async function EditTopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const [{ id }, { tab, status }] = await Promise.all([params, searchParams]);
  const [topic, artists] = await Promise.all([getTopic(id), getArtists()]);

  if (!topic) return notFound();

  const activeTab = tab === 'contributions' ? 'contributions' : 'edit';
  const activeStatus = status && STATUS_VALUES.has(status as ContributionStatus)
    ? (status as ContributionStatus)
    : undefined;
  const progress =
    topic.target_contributors > 0
      ? Math.min(100, Math.round((topic.stats.contributors / topic.target_contributors) * 100))
      : 0;

  return (
    <div>
      <BackLink href="/topics">All topics</BackLink>
      <PageHeader
        title={`Edit: ${topic.title}`}
        description={topic.id}
        badge={{ label: topic.status, variant: topicStatusVariant(topic.status) }}
      />

      <TopicTabs
        topicId={topic.id}
        pendingCount={topic.stats.pendingContributions}
        totalCount={topic.stats.contributions + topic.stats.pendingContributions}
      />

      <EditPageLayout
        main={
          activeTab === 'contributions' ? (
            <TopicContributionsList topicId={topic.id} status={activeStatus} />
          ) : (
            <TopicForm topic={topic} artists={artists} />
          )
        }
        sidebar={
          <>
            <SidebarCard title="Progress">
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold text-gray-900">
                    {topic.stats.contributors}
                  </span>
                  <span className="text-xs text-gray-500">
                    of {topic.target_contributors}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-gray-900"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <dl className="grid grid-cols-2 gap-3 pt-1 text-xs">
                  <div>
                    <dt className="text-gray-500">Contributions</dt>
                    <dd className="font-medium text-gray-900">
                      {topic.stats.contributions}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Pending</dt>
                    <dd className="font-medium text-gray-900">
                      {topic.stats.pendingContributions}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Private</dt>
                    <dd className="font-medium text-gray-900">
                      {topic.stats.privateContributions}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Deadline</dt>
                    <dd className="font-medium text-gray-900">
                      {topic.deadline
                        ? new Date(topic.deadline).toLocaleDateString()
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            </SidebarCard>

            <SidebarCard
              title="Seed Contributions"
              description="Auto-generate realistic pending contributions to bootstrap engagement."
            >
              <div className="space-y-3">
                <TopicTasksStatus topicId={topic.id} />
                <GenerateContributionsButton topicId={topic.id} />
              </div>
            </SidebarCard>
          </>
        }
      />
    </div>
  );
}

function topicStatusVariant(status: 'active' | 'upcoming' | 'in_production' | 'completed') {
  if (status === 'active') return 'success' as const;
  if (status === 'in_production') return 'outline' as const;
  if (status === 'completed') return 'secondary' as const;
  return 'warning' as const;
}
