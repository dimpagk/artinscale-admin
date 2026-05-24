'use server';

import { revalidatePath } from 'next/cache';
import { updateContributionStatus } from '@/lib/contributions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ContributionVersion } from '@/lib/types';

export async function approveContribution(id: string, adminNotes?: string) {
  const result = await updateContributionStatus(id, 'approved', adminNotes);
  revalidatePath('/contributions');
  revalidatePath(`/contributions/${id}`);
  revalidatePath('/');
  return result;
}

export async function rejectContribution(id: string, adminNotes?: string) {
  const result = await updateContributionStatus(id, 'rejected', adminNotes);
  revalidatePath('/contributions');
  revalidatePath(`/contributions/${id}`);
  revalidatePath('/');
  return result;
}

export async function reopenContribution(id: string, adminNotes?: string) {
  const result = await updateContributionStatus(id, 'pending', adminNotes);
  revalidatePath('/contributions');
  revalidatePath(`/contributions/${id}`);
  revalidatePath('/');
  return result;
}

export async function bulkUpdateContributions(
  ids: string[],
  status: 'approved' | 'rejected',
  adminNotes?: string
): Promise<{ success: boolean; updated: number; error?: string }> {
  if (ids.length === 0) return { success: true, updated: 0 };

  let updated = 0;
  let firstError: string | undefined;

  for (const id of ids) {
    const result = await updateContributionStatus(id, status, adminNotes);
    if (result.success) updated++;
    else if (!firstError) firstError = result.error;
  }

  revalidatePath('/contributions');
  revalidatePath('/');

  if (firstError && updated === 0) {
    return { success: false, updated, error: firstError };
  }
  return { success: true, updated, error: firstError };
}

/**
 * Hard-delete pending studio_seed contributions. Refuses to delete
 * anything that is community-sourced or already approved/rejected so a
 * single bad call can't take out real submissions or audit trail.
 */
export async function bulkDeleteContributions(
  ids: string[]
): Promise<{ success: boolean; deleted: number; error?: string }> {
  if (ids.length === 0) return { success: true, deleted: 0 };

  const { data: rows, error: fetchError } = await supabaseAdmin
    .from('topic_contributions')
    .select('id, source, status')
    .in('id', ids);

  if (fetchError) return { success: false, deleted: 0, error: fetchError.message };

  const safeIds = (rows ?? [])
    .filter((r) => r.source === 'studio_seed' && r.status === 'pending')
    .map((r) => r.id);

  if (safeIds.length === 0) {
    return {
      success: false,
      deleted: 0,
      error: 'Nothing to delete — only pending studio seeds can be hard-deleted.',
    };
  }

  const { error: deleteError } = await supabaseAdmin
    .from('topic_contributions')
    .delete()
    .in('id', safeIds);

  if (deleteError) return { success: false, deleted: 0, error: deleteError.message };

  revalidatePath('/contributions');
  revalidatePath('/');

  return { success: true, deleted: safeIds.length };
}

/**
 * Restore a contribution's content/caption to a prior version captured
 * in `previous_versions`. The current state is pushed onto the stack so
 * Restore is itself reversible.
 */
export async function restoreContributionVersion(
  contributionId: string,
  versionIndex: number
): Promise<{ success: boolean; error?: string }> {
  const { data: row, error: fetchError } = await supabaseAdmin
    .from('topic_contributions')
    .select('id, content, caption, previous_versions')
    .eq('id', contributionId)
    .single();

  if (fetchError || !row) {
    return { success: false, error: fetchError?.message || 'Not found' };
  }

  const versions = Array.isArray(row.previous_versions)
    ? (row.previous_versions as ContributionVersion[])
    : [];
  const target = versions[versionIndex];
  if (!target) {
    return { success: false, error: 'Version not found' };
  }

  // Push current state onto history so Restore is undoable
  const snapshot: ContributionVersion = {
    at: new Date().toISOString(),
    content: row.content,
    caption: row.caption ?? null,
    refine_task_id: null,
    instructions: '(restored to a previous version)',
  };
  const nextVersions = [snapshot, ...versions.filter((_, i) => i !== versionIndex)].slice(0, 5);

  const { error: updateError } = await supabaseAdmin
    .from('topic_contributions')
    .update({
      content: target.content,
      caption: target.caption,
      previous_versions: nextVersions,
    })
    .eq('id', contributionId);

  if (updateError) return { success: false, error: updateError.message };

  revalidatePath('/contributions');
  revalidatePath(`/contributions/${contributionId}`);

  return { success: true };
}
