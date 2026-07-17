import Link from 'next/link';
import { getAllTopics } from '@/lib/topics';
import { Badge } from '@/components/ui/badge';
import {
  PageHeader,
  DataTable,
  EmptyState,
  StatusBadge,
  type DataTableColumn,
} from '@/components/admin-ui';

type TopicRow = Awaited<ReturnType<typeof getAllTopics>>[number];

/**
 * Sort accessors per sortable column. Topics load fully into memory
 * (with computed stats), so sorting happens here rather than in the
 * query — that also lets the computed stat columns sort. Return null
 * for missing values so they always land last, in both directions.
 */
const TOPIC_SORTERS: Record<
  string,
  (t: TopicRow) => string | number | null
> = {
  title: (t) => t.title.toLowerCase(),
  status: (t) => t.status,
  contributors: (t) => t.stats.contributors,
  pending: (t) => t.stats.pendingContributions,
  deadline: (t) => (t.deadline ? new Date(t.deadline).getTime() : null),
};

function sortTopics(
  rows: TopicRow[],
  sortKey: string | undefined,
  dir: 'asc' | 'desc'
): TopicRow[] {
  const accessor = sortKey ? TOPIC_SORTERS[sortKey] : undefined;
  if (!accessor) return rows;
  const factor = dir === 'desc' ? -1 : 1;
  // Stable sort preserves the created_at-desc order from the query as
  // the tiebreaker when sort values are equal.
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const dir = params.dir === 'desc' ? 'desc' : 'asc';
  const topics = sortTopics(await getAllTopics(), params.sort, dir);

  const columns: DataTableColumn<TopicRow>[] = [
    {
      key: 'title',
      header: 'Title',
      sortKey: 'title',
      render: (t) => (
        <div>
          <p className="font-medium text-gray-900">{t.title}</p>
          <p className="text-xs text-gray-500">{t.id}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (t) => <StatusBadge domain="topic" status={t.status} />,
    },
    {
      key: 'contributors',
      header: 'Contributors',
      sortKey: 'contributors',
      render: (t) => (
        <span className="text-gray-600">
          {t.stats.contributors} / {t.target_contributors}
        </span>
      ),
    },
    {
      key: 'pending',
      header: 'Pending',
      sortKey: 'pending',
      render: (t) =>
        t.stats.pendingContributions > 0 ? (
          <Badge variant="warning" size="sm">
            {t.stats.pendingContributions}
          </Badge>
        ) : (
          <span className="text-gray-400">0</span>
        ),
    },
    {
      key: 'deadline',
      header: 'Deadline',
      sortKey: 'deadline',
      render: (t) => (
        <span className="text-gray-600">
          {t.deadline ? new Date(t.deadline).toLocaleDateString() : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (t) => (
        <Link
          href={`/topics/${t.id}`}
          className="font-medium text-gray-600 hover:text-gray-900"
        >
          Edit
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Topics"
        action={{ href: '/topics/new', label: 'Create Topic' }}
      />
      <DataTable
        rows={topics}
        columns={columns}
        rowKey={(t) => t.id}
        sort={{ key: params.sort, dir, basePath: '/topics' }}
        emptyState={
          <EmptyState
            title="No topics yet"
            description="Topics drive the contribution → artwork narrative. The Topic Ideator agent can also draft proposals — they appear in the Inbox."
            action={{ href: '/topics/new', label: 'Create Topic' }}
          />
        }
      />
    </div>
  );
}
