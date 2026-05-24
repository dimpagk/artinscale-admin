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

export default async function TopicsPage() {
  const topics = await getAllTopics();

  const columns: DataTableColumn<TopicRow>[] = [
    {
      key: 'title',
      header: 'Title',
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
      render: (t) => <StatusBadge domain="topic" status={t.status} />,
    },
    {
      key: 'contributors',
      header: 'Contributors',
      render: (t) => (
        <span className="text-gray-600">
          {t.stats.contributors} / {t.target_contributors}
        </span>
      ),
    },
    {
      key: 'pending',
      header: 'Pending',
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
