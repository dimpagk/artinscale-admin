import { notFound } from 'next/navigation';
import { getArtworkById } from '@/lib/artworks';
import { getArtists } from '@/lib/users';
import { getAllTopics } from '@/lib/topics';
import { ArtworkForm } from '@/components/artworks/artwork-form';
import { Badge } from '@/components/ui/badge';

const statusVariant = {
  created: 'warning' as const,
  listed: 'success' as const,
  sold: 'secondary' as const,
};

export default async function EditArtworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [artwork, artists, topicsWithStats] = await Promise.all([
    getArtworkById(id),
    getArtists(),
    getAllTopics(),
  ]);

  if (!artwork) return notFound();

  const topics = topicsWithStats.map((t) => ({ id: t.id, title: t.title }));

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Edit: {artwork.title}</h1>
        <Badge variant={statusVariant[artwork.status]} size="sm">
          {artwork.status}
        </Badge>
      </div>
      <div className="mb-4 text-sm text-gray-500">
        {artwork.users?.name || 'No artist'} &middot; {artwork.topics?.title || 'No topic'} &middot;{' '}
        {artwork.edition_size != null
          ? `Edition: ${artwork.edition_sold} / ${artwork.edition_size}`
          : 'Open edition'}
      </div>
      <ArtworkForm
        artwork={artwork}
        artists={artists.map((a) => ({ id: a.id, name: a.name || a.email }))}
        topics={topics}
      />
    </div>
  );
}
