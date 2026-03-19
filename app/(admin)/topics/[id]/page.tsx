import { notFound } from 'next/navigation';
import { getTopic } from '@/lib/topics';
import { getArtists } from '@/lib/users';
import { TopicForm } from '@/components/topics/topic-form';
import { Badge } from '@/components/ui/badge';

export default async function EditTopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [topic, artists] = await Promise.all([getTopic(id), getArtists()]);

  if (!topic) return notFound();

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Edit: {topic.title}</h1>
        <Badge
          variant={
            topic.status === 'active' ? 'success' : topic.status === 'completed' ? 'secondary' : 'warning'
          }
          size="sm"
        >
          {topic.status}
        </Badge>
      </div>
      <div className="mb-4 text-sm text-gray-500">
        {topic.stats.contributors} contributors &middot; {topic.stats.contributions} contributions &middot;{' '}
        {topic.stats.pendingContributions} pending
      </div>
      <TopicForm topic={topic} artists={artists} />
    </div>
  );
}
