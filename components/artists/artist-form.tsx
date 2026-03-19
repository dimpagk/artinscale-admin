'use client';

import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { User } from '@/lib/types';
import { createArtistAction, updateArtistAction } from '@/app/(admin)/artists/actions';

interface ArtistFormProps {
  artist?: User;
}

export function ArtistForm({ artist }: ArtistFormProps) {
  const router = useRouter();
  const isEditing = !!artist;

  const handleSubmit = async (formData: FormData) => {
    if (isEditing) {
      await updateArtistAction(artist.id, formData);
    } else {
      await createArtistAction(formData);
    }
  };

  return (
    <form action={handleSubmit} className="max-w-xl space-y-6">
      {!isEditing && (
        <Input
          name="email"
          label="Email"
          type="email"
          required
          placeholder="artist@example.com"
        />
      )}

      <Input
        name="name"
        label="Name"
        defaultValue={artist?.name || ''}
        placeholder="Artist name"
      />

      <Textarea
        name="bio"
        label="Bio"
        defaultValue={artist?.bio || ''}
        rows={4}
        placeholder="Brief artist biography..."
      />

      <Input
        name="portfolio"
        label="Portfolio URL"
        type="url"
        defaultValue={artist?.portfolio || ''}
        placeholder="https://..."
      />

      <div className="flex items-center gap-3 pt-4">
        <Button type="submit">{isEditing ? 'Save Changes' : 'Add Artist'}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push('/artists')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
