import { supabaseAdmin } from './supabase/admin';
import type { TopicRow, TopicStats, ContributionTypeConfig } from './types';

async function getTopicStats(topicId: string): Promise<TopicStats> {
  const { data: contributions } = await supabaseAdmin
    .from('topic_contributions')
    .select('contributor_email, status, show_publicly')
    .eq('topic_id', topicId)
    .neq('status', 'rejected');

  if (!contributions) {
    return { contributors: 0, contributions: 0, privateContributions: 0, pendingContributions: 0 };
  }

  const uniqueEmails = new Set(contributions.map((c) => c.contributor_email));
  const privateCount = contributions.filter((c) => c.status === 'approved' && !c.show_publicly).length;
  const pendingCount = contributions.filter((c) => c.status === 'pending').length;

  return {
    contributors: uniqueEmails.size,
    contributions: contributions.length,
    privateContributions: privateCount,
    pendingContributions: pendingCount,
  };
}

async function getMultipleTopicStats(topicIds: string[]): Promise<Map<string, TopicStats>> {
  const statsMap = new Map<string, TopicStats>();
  if (topicIds.length === 0) return statsMap;

  const { data: contributions } = await supabaseAdmin
    .from('topic_contributions')
    .select('topic_id, contributor_email, status, show_publicly')
    .in('topic_id', topicIds)
    .neq('status', 'rejected');

  if (!contributions) {
    topicIds.forEach((id) =>
      statsMap.set(id, { contributors: 0, contributions: 0, privateContributions: 0, pendingContributions: 0 })
    );
    return statsMap;
  }

  const byTopic = new Map<string, typeof contributions>();
  contributions.forEach((c) => {
    const items = byTopic.get(c.topic_id) || [];
    items.push(c);
    byTopic.set(c.topic_id, items);
  });

  topicIds.forEach((id) => {
    const items = byTopic.get(id) || [];
    const uniqueEmails = new Set(items.map((i) => i.contributor_email));
    statsMap.set(id, {
      contributors: uniqueEmails.size,
      contributions: items.length,
      privateContributions: items.filter((i) => i.status === 'approved' && !i.show_publicly).length,
      pendingContributions: items.filter((i) => i.status === 'pending').length,
    });
  });

  return statsMap;
}

export interface TopicWithStats extends TopicRow {
  stats: TopicStats;
}

export async function getAllTopics(): Promise<TopicWithStats[]> {
  const { data: topics, error } = await supabaseAdmin
    .from('topics')
    .select('*, users (id, name, bio, portfolio)')
    .order('created_at', { ascending: false });

  if (error || !topics) return [];

  const topicIds = topics.map((t) => t.id);
  const statsMap = await getMultipleTopicStats(topicIds);

  return topics.map((row) => ({
    ...(row as TopicRow),
    stats: statsMap.get(row.id) || { contributors: 0, contributions: 0, privateContributions: 0, pendingContributions: 0 },
  }));
}

export async function getTopic(id: string): Promise<TopicWithStats | null> {
  const { data: topic, error } = await supabaseAdmin
    .from('topics')
    .select('*, users (id, name, bio, portfolio)')
    .eq('id', id)
    .single();

  if (error || !topic) return null;

  const stats = await getTopicStats(id);
  return { ...(topic as TopicRow), stats };
}

export async function createTopic(data: {
  id: string;
  title: string;
  description: string;
  long_description?: string;
  status?: string;
  target_contributors?: number;
  deadline?: string;
  estimated_completion?: string;
  artist_id?: string;
  contribution_types?: ContributionTypeConfig[];
  prompts?: string[];
}) {
  const { error } = await supabaseAdmin.from('topics').insert({
    id: data.id,
    title: data.title,
    description: data.description,
    long_description: data.long_description || null,
    status: data.status || 'upcoming',
    target_contributors: data.target_contributors || 50,
    deadline: data.deadline || null,
    estimated_completion: data.estimated_completion || null,
    artist_id: data.artist_id || null,
    contribution_types: data.contribution_types || [],
    prompts: data.prompts || [],
  });

  if (error) throw error;
}

export async function updateTopic(
  id: string,
  data: {
    title?: string;
    description?: string;
    long_description?: string | null;
    status?: string;
    target_contributors?: number;
    deadline?: string | null;
    estimated_completion?: string | null;
    completed_date?: string | null;
    artist_id?: string | null;
    contribution_types?: ContributionTypeConfig[];
    prompts?: string[];
  }
) {
  const { error } = await supabaseAdmin.from('topics').update(data).eq('id', id);
  if (error) throw error;
}

export async function deleteTopic(id: string) {
  const { error } = await supabaseAdmin.from('topics').delete().eq('id', id);
  if (error) throw error;
}
