'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createTopic, updateTopic, deleteTopic } from '@/lib/topics';

export async function createTopicAction(formData: FormData) {
  const id = formData.get('id') as string;
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const longDescription = formData.get('long_description') as string;
  const status = formData.get('status') as string;
  const targetContributors = parseInt(formData.get('target_contributors') as string) || 50;
  const deadline = formData.get('deadline') as string;
  const estimatedCompletion = formData.get('estimated_completion') as string;
  const artistId = formData.get('artist_id') as string;
  const promptsRaw = formData.get('prompts') as string;
  const contributionTypesRaw = formData.get('contribution_types') as string;

  let prompts: string[] = [];
  try {
    prompts = promptsRaw ? JSON.parse(promptsRaw) : [];
  } catch {
    prompts = promptsRaw ? promptsRaw.split('\n').filter(Boolean) : [];
  }

  let contributionTypes = [];
  try {
    contributionTypes = contributionTypesRaw ? JSON.parse(contributionTypesRaw) : [];
  } catch {
    contributionTypes = [];
  }

  await createTopic({
    id,
    title,
    description,
    long_description: longDescription || undefined,
    status: status || 'upcoming',
    target_contributors: targetContributors,
    deadline: deadline || undefined,
    estimated_completion: estimatedCompletion || undefined,
    artist_id: artistId || undefined,
    prompts,
    contribution_types: contributionTypes,
  });

  revalidatePath('/topics');
  redirect('/topics');
}

export async function updateTopicAction(id: string, formData: FormData) {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const longDescription = formData.get('long_description') as string;
  const status = formData.get('status') as string;
  const targetContributors = parseInt(formData.get('target_contributors') as string) || 50;
  const deadline = formData.get('deadline') as string;
  const estimatedCompletion = formData.get('estimated_completion') as string;
  const completedDate = formData.get('completed_date') as string;
  const artistId = formData.get('artist_id') as string;
  const promptsRaw = formData.get('prompts') as string;
  const contributionTypesRaw = formData.get('contribution_types') as string;

  let prompts: string[] = [];
  try {
    prompts = promptsRaw ? JSON.parse(promptsRaw) : [];
  } catch {
    prompts = promptsRaw ? promptsRaw.split('\n').filter(Boolean) : [];
  }

  let contributionTypes = [];
  try {
    contributionTypes = contributionTypesRaw ? JSON.parse(contributionTypesRaw) : [];
  } catch {
    contributionTypes = [];
  }

  await updateTopic(id, {
    title,
    description,
    long_description: longDescription || undefined,
    status,
    target_contributors: targetContributors,
    deadline: deadline || undefined,
    estimated_completion: estimatedCompletion || undefined,
    completed_date: completedDate || undefined,
    artist_id: artistId || undefined,
    prompts,
    contribution_types: contributionTypes,
  });

  revalidatePath('/topics');
  redirect('/topics');
}

export async function deleteTopicAction(id: string) {
  await deleteTopic(id);
  revalidatePath('/topics');
  redirect('/topics');
}
