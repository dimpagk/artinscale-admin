import { getArtists } from '@/lib/users';
import { TopicForm } from '@/components/topics/topic-form';

export default async function NewTopicPage() {
  const artists = await getArtists();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Create Topic</h1>
      <TopicForm artists={artists} />
    </div>
  );
}
