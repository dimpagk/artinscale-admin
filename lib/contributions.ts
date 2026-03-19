import { supabaseAdmin } from './supabase/admin';
import type { Contribution, ContributionStatus, ContributionType } from './types';

export interface ContributionFilters {
  status?: ContributionStatus;
  topic_id?: string;
  type?: ContributionType;
}

export async function getAllContributions(filters?: ContributionFilters): Promise<Contribution[]> {
  let query = supabaseAdmin
    .from('topic_contributions')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.topic_id) {
    query = query.eq('topic_id', filters.topic_id);
  }
  if (filters?.type) {
    query = query.eq('type', filters.type);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching contributions:', error);
    return [];
  }
  return data || [];
}

export async function getContributionById(id: string): Promise<Contribution | null> {
  const { data, error } = await supabaseAdmin
    .from('topic_contributions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching contribution:', error);
    return null;
  }
  return data;
}

export async function getContributionStats() {
  const { data, error } = await supabaseAdmin
    .from('topic_contributions')
    .select('status');

  if (error || !data) return { pending: 0, approved: 0, rejected: 0, total: 0 };

  return {
    pending: data.filter((c) => c.status === 'pending').length,
    approved: data.filter((c) => c.status === 'approved').length,
    rejected: data.filter((c) => c.status === 'rejected').length,
    total: data.length,
  };
}

export async function getPendingContributions(): Promise<Contribution[]> {
  const { data, error } = await supabaseAdmin
    .from('topic_contributions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) return [];
  return data || [];
}

export async function updateContributionStatus(
  id: string,
  status: 'approved' | 'rejected',
  adminNotes?: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('topic_contributions')
    .update({
      status,
      admin_notes: adminNotes || null,
    })
    .eq('id', id);

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}
