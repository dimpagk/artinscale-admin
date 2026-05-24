'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormActions, FormCard } from '@/components/admin-ui';
import type { User } from '@/lib/types';
import {
  createArtistAction,
  updateArtistAction,
} from '@/app/(admin)/artists/actions';

interface ArtistFormProps {
  artist?: User;
}

export function ArtistForm({ artist }: ArtistFormProps) {
  const isEditing = !!artist;

  const handleSubmit = async (formData: FormData) => {
    if (isEditing) {
      await updateArtistAction(artist.id, formData);
    } else {
      await createArtistAction(formData);
    }
  };

  return (
    <form action={handleSubmit} className="space-y-6">
      <FormCard
        title="Profile"
        description="Public-facing identity. Shown on the artist's storefront page and used in any auto-generated copy."
      >
        {!isEditing && (
          <Input
            name="email"
            label="Email"
            type="email"
            required
            placeholder="artist@example.com"
            helperText="Used to invite the artist if they want to log in later."
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
          helperText="Markdown supported."
        />

        <Input
          name="portfolio"
          label="Portfolio URL"
          type="url"
          defaultValue={artist?.portfolio || ''}
          placeholder="https://..."
        />
      </FormCard>

      <FormActions
        submitLabel={isEditing ? 'Save Changes' : 'Add Artist'}
        cancelHref="/artists"
      />
    </form>
  );
}
