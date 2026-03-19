import { getArtists } from '@/lib/users';
import { getAllTopics } from '@/lib/topics';
import { ArtworkForm } from '@/components/artworks/artwork-form';

export default async function NewArtworkPage() {
  const [artists, topicsWithStats] = await Promise.all([getArtists(), getAllTopics()]);

  const topics = topicsWithStats.map((t) => ({ id: t.id, title: t.title }));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">New Artwork</h1>
      <ArtworkForm
        artists={artists.map((a) => ({ id: a.id, name: a.name || a.email }))}
        topics={topics}
      />
    </div>
  );
}
