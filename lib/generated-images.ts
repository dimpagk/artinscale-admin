import { supabaseAdmin } from './supabase/admin';
import type { GeneratedImage, GeneratedImageFilters } from './constants/art-generator';

export async function getGeneratedImages(
  filters?: GeneratedImageFilters
): Promise<GeneratedImage[]> {
  let query = supabaseAdmin
    .from('generated_images')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.topic_id) {
    query = query.eq('topic_id', filters.topic_id);
  }
  if (filters?.artwork_id) {
    query = query.eq('artwork_id', filters.artwork_id);
  }

  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching generated images:', error);
    return [];
  }
  return data || [];
}

export async function getGeneratedImageById(
  id: string
): Promise<GeneratedImage | null> {
  const { data, error } = await supabaseAdmin
    .from('generated_images')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching generated image:', error);
    return null;
  }
  return data;
}

export async function createGeneratedImage(
  data: Omit<GeneratedImage, 'id' | 'created_at'>
): Promise<GeneratedImage | null> {
  const { data: created, error } = await supabaseAdmin
    .from('generated_images')
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error('Error creating generated image:', error);
    return null;
  }
  return created;
}

export async function updateGeneratedImage(
  id: string,
  data: Partial<GeneratedImage>
): Promise<GeneratedImage | null> {
  const { data: updated, error } = await supabaseAdmin
    .from('generated_images')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating generated image:', error);
    return null;
  }
  return updated;
}

export async function deleteGeneratedImage(
  id: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('generated_images')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting generated image:', error);
    return false;
  }
  return true;
}

export async function getContributionsForPrompt(
  topicId: string
): Promise<{ content: string; caption: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('topic_contributions')
    .select('content, caption')
    .eq('topic_id', topicId)
    .eq('status', 'approved');

  if (error) {
    console.error('Error fetching contributions for prompt:', error);
    return [];
  }
  return data || [];
}
