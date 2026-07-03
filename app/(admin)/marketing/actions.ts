'use server';

/**
 * Ad-creative review actions. Edit the copy, or move a creative through
 * draft -> approved / rejected. Review-only: nothing here publishes to any
 * ad platform. See lib/ad-creatives.ts and migration 046.
 */

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AdCreativeStatus } from '@/lib/ad-creatives';

export interface SaveCreativeResult {
  ok: boolean;
  message: string;
}

const STATUSES: AdCreativeStatus[] = ['draft', 'approved', 'rejected'];

export async function saveAdCreativeAction(input: {
  id: string;
  headline: string;
  primaryText: string;
  notes: string;
}): Promise<SaveCreativeResult> {
  const headline = input.headline.trim();
  const primaryText = input.primaryText.trim();
  if (!headline && !primaryText) {
    return { ok: false, message: 'Headline and primary text cannot both be empty.' };
  }

  const { error } = await supabaseAdmin
    .from('ad_creatives')
    .update({
      headline,
      primary_text: primaryText,
      notes: input.notes.trim() || null,
    })
    .eq('id', input.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath('/marketing');
  return { ok: true, message: 'Saved.' };
}

export async function setAdCreativeStatusAction(input: {
  id: string;
  status: AdCreativeStatus;
}): Promise<SaveCreativeResult> {
  if (!STATUSES.includes(input.status)) {
    return { ok: false, message: `Invalid status: ${input.status}` };
  }
  const { error } = await supabaseAdmin
    .from('ad_creatives')
    .update({ status: input.status })
    .eq('id', input.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath('/marketing');
  return { ok: true, message: `Marked ${input.status}.` };
}
