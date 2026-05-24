import { ArtistForm } from '@/components/artists/artist-form';
import { BackLink, PageHeader } from '@/components/admin-ui';

export default function NewArtistPage() {
  return (
    <div className="max-w-3xl">
      <BackLink href="/artists">All artists</BackLink>
      <PageHeader
        title="Add Artist"
        description="Create a new artist persona. After saving, link a style pack from the artist's edit page."
      />
      <ArtistForm />
    </div>
  );
}
