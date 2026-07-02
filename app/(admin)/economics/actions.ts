'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Update the singleton finance_settings row that the margin views depend
 * on. Empty fields are ignored so a partial form submit doesn't null out
 * rates.
 */
export async function saveFinanceSettingsAction(formData: FormData) {
  const numField = (name: string): number | undefined => {
    const raw = formData.get(name) as string | null;
    if (raw == null || raw.trim() === '') return undefined;
    const n = parseFloat(raw);
    return Number.isNaN(n) ? undefined : n;
  };

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    payment_fee_percent: 'payment_fee_percent',
    payment_fee_fixed: 'payment_fee_fixed',
    default_vat_percent: 'default_vat_percent',
    monthly_fixed_cost: 'monthly_fixed_cost',
    creation_fx_usd_to_eur: 'creation_fx_usd_to_eur',
    default_community_artist_fee: 'default_community_artist_fee',
    default_community_royalty_percent: 'default_community_royalty_percent',
  };
  for (const [field, col] of Object.entries(map)) {
    const v = numField(field);
    if (v !== undefined) update[col] = v;
  }
  const currency = (formData.get('reporting_currency') as string | null)?.trim();
  if (currency) update.reporting_currency = currency;

  const { error } = await supabaseAdmin
    .from('finance_settings')
    .upsert({ id: true, ...update }, { onConflict: 'id' });
  if (error) throw new Error(`Failed to save finance settings: ${error.message}`);

  revalidatePath('/economics');
}

/** Log a marketing spend entry (ad spend is blended, not per-order). */
export async function addMarketingSpendAction(formData: FormData) {
  const spendDate = (formData.get('spend_date') as string)?.trim();
  const channel = ((formData.get('channel') as string) || 'meta').trim();
  const campaign = (formData.get('campaign') as string)?.trim() || null;
  const amountRaw = (formData.get('amount') as string)?.trim();
  const currency = ((formData.get('currency') as string) || 'EUR').trim();
  const notes = (formData.get('notes') as string)?.trim() || null;

  const amount = amountRaw ? parseFloat(amountRaw) : NaN;
  if (!spendDate || Number.isNaN(amount)) {
    throw new Error('Marketing spend needs a date and an amount.');
  }

  const { error } = await supabaseAdmin.from('marketing_spend').insert({
    spend_date: spendDate,
    channel,
    campaign,
    amount,
    currency,
    notes,
  });
  if (error) throw new Error(`Failed to add marketing spend: ${error.message}`);

  revalidatePath('/economics');
}

export async function deleteMarketingSpendAction(id: string) {
  const { error } = await supabaseAdmin.from('marketing_spend').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete marketing spend: ${error.message}`);
  revalidatePath('/economics');
}
