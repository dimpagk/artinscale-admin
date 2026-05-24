import { getArtists } from '@/lib/users';
import { TopicForm } from '@/components/topics/topic-form';
import { BackLink, PageHeader } from '@/components/admin-ui';

export default async function NewTopicPage() {
  const artists = await getArtists();

  return (
    <div className="max-w-3xl">
      <BackLink href="/topics">All topics</BackLink>
      <PageHeader
        title="Create Topic"
        description="Topics organize community contributions around a theme. Each one becomes a public landing page on the storefront."
      />
      <TopicForm artists={artists} />
    </div>
  );
}
