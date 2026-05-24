import { getArtists } from '@/lib/users';
import { getAllTopics } from '@/lib/topics';
import { ArtworkForm } from '@/components/artworks/artwork-form';
import { BackLink, PageHeader } from '@/components/admin-ui';

export default async function NewArtworkPage() {
  const [artists, topicsWithStats] = await Promise.all([getArtists(), getAllTopics()]);

  const topics = topicsWithStats.map((t) => ({ id: t.id, title: t.title }));

  return (
    <div className="max-w-3xl">
      <BackLink href="/artworks">All artworks</BackLink>
      <PageHeader
        title="New Artwork"
        description="Create a piece manually. Most pieces are created by the AI Art Generator (under AI Art) and land here automatically."
      />
      <ArtworkForm
        artists={artists.map((a) => ({ id: a.id, name: a.name || a.email }))}
        topics={topics}
      />
    </div>
  );
}
