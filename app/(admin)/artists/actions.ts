'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createUser, updateUser } from '@/lib/users';
import type { ArtistKind } from '@/lib/types';

// The form requires a kind; validate server-side so a missing or tampered
// value is rejected rather than silently stored.
function parseKind(formData: FormData): ArtistKind {
  const kind = formData.get('kind');
  if (kind === 'studio' || kind === 'community' || kind === 'classic') {
    return kind;
  }
  throw new Error('A valid artist kind is required.');
}

// Per-sale royalty %. Blank leaves it null (finance_settings fallback applies).
function parseRoyalty(formData: FormData): number | null {
  const raw = (formData.get('royalty_percent') as string | null)?.trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? null : n;
}

export async function createArtistAction(formData: FormData) {
  const email = formData.get('email') as string;
  const name = formData.get('name') as string;
  const bio = formData.get('bio') as string;
  const portfolio = formData.get('portfolio') as string;
  const artistKind = parseKind(formData);
  const royaltyPercent = parseRoyalty(formData);

  const artist = await createUser({
    email,
    name: name || undefined,
    bio: bio || undefined,
    portfolio: portfolio || undefined,
    role: 'ARTIST',
    artistKind,
    royaltyPercent,
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
  const artistKind = parseKind(formData);
  const royaltyPercent = parseRoyalty(formData);

  await updateUser(id, {
    name: name || null,
    bio: bio || null,
    portfolio: portfolio || null,
    artist_kind: artistKind,
    royalty_percent: royaltyPercent,
  });

  revalidatePath('/artists');
  redirect('/artists');
}
