import { supabaseAdmin } from './supabase/admin';

export const STORAGE_BUCKETS = {
  contributions: 'contributions',
  artworks: 'artworks',
  profiles: 'profiles',
  'ai-generated': 'ai-generated',
} as const;

export type StorageBucket = keyof typeof STORAGE_BUCKETS;

export async function uploadFile(
  bucket: StorageBucket,
  path: string,
  file: File | Buffer,
  options?: {
    contentType?: string;
    cacheControl?: string;
    upsert?: boolean;
  }
) {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS[bucket])
    .upload(path, file, {
      contentType: options?.contentType,
      cacheControl: options?.cacheControl || '3600',
      upsert: options?.upsert || false,
    });

  if (error) throw error;
  return data;
}

export function getPublicUrl(bucket: StorageBucket, path: string) {
  const { data } = supabaseAdmin.storage.from(STORAGE_BUCKETS[bucket]).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteFile(bucket: StorageBucket, path: string) {
  const { error } = await supabaseAdmin.storage.from(STORAGE_BUCKETS[bucket]).remove([path]);
  if (error) throw error;
  return true;
}
