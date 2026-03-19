'use server';

import { revalidatePath } from 'next/cache';
import { updateContributionStatus } from '@/lib/contributions';

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
