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

export interface ContributionStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
  approvalRate: number;
  uniqueContributors: number;
  byType: Record<ContributionType, number>;
  bySource: { community: number; studio_seed: number };
  recent7d: number;
  recent30d: number;
}

export async function getContributionStats(filters?: {
  topic_id?: string;
}): Promise<ContributionStats> {
  const empty: ContributionStats = {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
    approvalRate: 0,
    uniqueContributors: 0,
    byType: { story: 0, photo: 0, sound: 0, link: 0 },
    bySource: { community: 0, studio_seed: 0 },
    recent7d: 0,
    recent30d: 0,
  };

  let query = supabaseAdmin
    .from('topic_contributions')
    .select('status, type, source, contributor_email, created_at');
  if (filters?.topic_id) query = query.eq('topic_id', filters.topic_id);

  const { data, error } = await query;
  if (error || !data) return empty;

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const byType: Record<ContributionType, number> = { story: 0, photo: 0, sound: 0, link: 0 };
  const bySource = { community: 0, studio_seed: 0 };
  const emails = new Set<string>();
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let recent7d = 0;
  let recent30d = 0;

  for (const c of data) {
    if (c.status === 'pending') pending++;
    else if (c.status === 'approved') approved++;
    else if (c.status === 'rejected') rejected++;

    if (c.type && c.type in byType) byType[c.type as ContributionType]++;

    if (c.source === 'studio_seed') bySource.studio_seed++;
    else bySource.community++;

    if (c.contributor_email) emails.add(c.contributor_email);

    const createdMs = new Date(c.created_at).getTime();
    if (createdMs >= sevenDaysAgo) recent7d++;
    if (createdMs >= thirtyDaysAgo) recent30d++;
  }

  const decided = approved + rejected;
  const approvalRate = decided > 0 ? Math.round((approved / decided) * 100) : 0;

  return {
    pending,
    approved,
    rejected,
    total: data.length,
    approvalRate,
    uniqueContributors: emails.size,
    byType,
    bySource,
    recent7d,
    recent30d,
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
  status: ContributionStatus,
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
