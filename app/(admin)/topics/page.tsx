import Link from 'next/link';
import { getAllTopics } from '@/lib/topics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const statusVariant = {
  active: 'success' as const,
  completed: 'secondary' as const,
  upcoming: 'warning' as const,
};

export default async function TopicsPage() {
  const topics = await getAllTopics();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Topics</h1>
        <Link href="/topics/new">
          <Button>Create Topic</Button>
        </Link>
      </div>

      <Card padding="none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
              <th className="px-6 py-3 font-medium">Title</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Contributors</th>
              <th className="px-6 py-3 font-medium">Pending</th>
              <th className="px-6 py-3 font-medium">Deadline</th>
              <th className="px-6 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {topics.map((topic) => (
              <tr key={topic.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div>
                    <p className="font-medium text-gray-900">{topic.title}</p>
                    <p className="text-xs text-gray-500">{topic.id}</p>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={statusVariant[topic.status]} size="sm">
                    {topic.status}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {topic.stats.contributors} / {topic.target_contributors}
                </td>
                <td className="px-6 py-4">
                  {topic.stats.pendingContributions > 0 ? (
                    <Badge variant="warning" size="sm">
                      {topic.stats.pendingContributions}
                    </Badge>
                  ) : (
                    <span className="text-sm text-gray-400">0</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {topic.deadline
                    ? new Date(topic.deadline).toLocaleDateString()
                    : '-'}
                </td>
                <td className="px-6 py-4">
                  <Link
                    href={`/topics/${topic.id}`}
                    className="text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {topics.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                  No topics yet. Create your first topic.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
