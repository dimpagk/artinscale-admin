import { notFound } from 'next/navigation';
import { getUserById } from '@/lib/users';
import { ArtistForm } from '@/components/artists/artist-form';

export default async function EditArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artist = await getUserById(id);

  if (!artist || artist.role !== 'ARTIST') return notFound();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        Edit: {artist.name || artist.email}
      </h1>
      <ArtistForm artist={artist} />
    </div>
  );
}
