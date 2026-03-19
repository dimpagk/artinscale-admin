import Link from 'next/link';
import { getAllContributions, getContributionStats } from '@/lib/contributions';
import { getAllTopics } from '@/lib/topics';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ContributionsFilter } from '@/components/contributions/contributions-filter';
import type { ContributionStatus, ContributionType } from '@/lib/types';

const statusVariant = {
  pending: 'warning' as const,
  approved: 'success' as const,
  rejected: 'error' as const,
};

export default async function ContributionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; topic_id?: string; type?: string }>;
}) {
  const params = await searchParams;
  const filters = {
    status: (params.status || undefined) as ContributionStatus | undefined,
    topic_id: params.topic_id || undefined,
    type: (params.type || undefined) as ContributionType | undefined,
  };

  const [contributions, stats, topics] = await Promise.all([
    getAllContributions(filters),
    getContributionStats(),
    getAllTopics(),
  ]);

  const topicOptions = topics.map((t) => ({ value: t.id, label: t.title }));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Contributions</h1>

      <ContributionsFilter
        currentStatus={filters.status}
        currentTopicId={filters.topic_id}
        currentType={filters.type}
        topics={topicOptions}
        stats={stats}
      />

      <Card padding="none" className="mt-4">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
              <th className="px-6 py-3 font-medium">Contributor</th>
              <th className="px-6 py-3 font-medium">Topic</th>
              <th className="px-6 py-3 font-medium">Type</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Date</th>
              <th className="px-6 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {contributions.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <p className="text-sm font-medium text-gray-900">{c.contributor_name}</p>
                  <p className="text-xs text-gray-500">{c.contributor_email}</p>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{c.topic_id}</td>
                <td className="px-6 py-4">
                  <Badge variant="outline" size="sm">{c.type}</Badge>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={statusVariant[c.status]} size="sm">{c.status}</Badge>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(c.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <Link
                    href={`/contributions/${c.id}`}
                    className="text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
            {contributions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                  No contributions found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
