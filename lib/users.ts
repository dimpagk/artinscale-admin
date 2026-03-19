import { supabaseAdmin } from './supabase/admin';
import type { User } from './types';

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

export async function createUser(user: {
  email: string;
  name?: string;
  bio?: string;
  portfolio?: string;
  image?: string;
  role: 'CONTRIBUTOR' | 'ARTIST' | 'ADMIN';
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
