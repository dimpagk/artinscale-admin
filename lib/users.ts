import { supabaseAdmin } from './supabase/admin';
import type { ArtistKind, User } from './types';

export async function getAllUsers(): Promise<User[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function getArtists(): Promise<User[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('role', 'ARTIST')
    .order('name', { ascending: true });

  if (error) return [];
  return data || [];
}

export interface ArtistListOptions {
  /** Free-text search over name + email + bio. */
  q?: string
  kind?: ArtistKind
  page?: number
  pageSize?: number
}

export interface ArtistListResult {
  rows: User[]
  total: number
  /** Effective page served — may differ from the requested page when a stale link points past the last page. */
  page: number
}

export async function listArtists(
  options: ArtistListOptions = {}
): Promise<ArtistListResult> {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = options.pageSize ?? 20

  const build = (p: number) => {
    let query = supabaseAdmin
      .from('users')
      .select('*', { count: 'exact' })
      .eq('role', 'ARTIST')

    if (options.kind) query = query.eq('artist_kind', options.kind)
    // Commas and parens would break PostgREST's .or() filter syntax.
    const q = options.q?.replace(/[,()]/g, ' ').trim()
    if (q) {
      query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,bio.ilike.%${q}%`)
    }

    const from = (p - 1) * pageSize
    return query
      .order('name', { ascending: true })
      .range(from, from + pageSize - 1)
  }

  let effectivePage = page
  let { data, error, count } = await build(page)

  // A stale page link past the last row makes PostgREST reject the
  // range (or return an empty page) — recover by re-counting and
  // serving the last real page.
  if (error && page > 1) {
    effectivePage = 1
    ;({ data, error, count } = await build(1))
    const lastPage = Math.max(1, Math.ceil((count ?? 0) / pageSize))
    if (!error && lastPage > 1) {
      effectivePage = lastPage
      ;({ data, error, count } = await build(lastPage))
    }
  } else if (!error && page > 1 && (data?.length ?? 0) === 0 && (count ?? 0) > 0) {
    effectivePage = Math.max(1, Math.ceil((count ?? 0) / pageSize))
    ;({ data, error, count } = await build(effectivePage))
  }

  if (error) {
    console.error('Error listing artists:', error)
    return { rows: [], total: 0, page: 1 }
  }

  return { rows: data ?? [], total: count ?? 0, page: effectivePage }
}

export async function createUser(user: {
  email: string;
  name?: string;
  bio?: string;
  portfolio?: string;
  image?: string;
  role: 'CONTRIBUTOR' | 'ARTIST' | 'ADMIN';
  artistKind?: ArtistKind;
  royaltyPercent?: number | null;
}): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      email: user.email,
      name: user.name || null,
      bio: user.bio || null,
      portfolio: user.portfolio || null,
      image: user.image || null,
      role: user.role,
      artist_kind: user.artistKind ?? null,
      royalty_percent: user.royaltyPercent ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating user:', error);
    return null;
  }
  return data;
}

export async function updateUser(
  id: string,
  data: {
    name?: string | null;
    bio?: string | null;
    portfolio?: string | null;
    image?: string | null;
    artist_kind?: ArtistKind | null;
    royalty_percent?: number | null;
  }
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('users')
    .update(data)
    .eq('id', id);

  if (error) {
    console.error('Error updating user:', error);
    return false;
  }
  return true;
}
