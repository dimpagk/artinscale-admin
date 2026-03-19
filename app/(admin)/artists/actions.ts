'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createUser, updateUser } from '@/lib/users';

export async function createArtistAction(formData: FormData) {
  const email = formData.get('email') as string;
  const name = formData.get('name') as string;
  const bio = formData.get('bio') as string;
  const portfolio = formData.get('portfolio') as string;

  const artist = await createUser({
    email,
    name: name || undefined,
    bio: bio || undefined,
    portfolio: portfolio || undefined,
    role: 'ARTIST',
  });

  if (!artist) {
    throw new Error('Failed to create artist. The email may already be in use.');
  }

  revalidatePath('/artists');
  redirect('/artists');
}

export async function updateArtistAction(id: string, formData: FormData) {
  const name = formData.get('name') as string;
  const bio = formData.get('bio') as string;
  const portfolio = formData.get('portfolio') as string;

  await updateUser(id, {
    name: name || null,
    bio: bio || null,
    portfolio: portfolio || null,
  });

  revalidatePath('/artists');
  redirect('/artists');
}
