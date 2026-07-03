'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  getPnlDrilldown,
  type PnlGranularity,
  type DrilldownRow,
} from '@/lib/costs/pnl';

/**
 * The underlying orders / expenses behind one P&L matrix cell. Called from
 * the matrix client component when the operator clicks a cell.
 */
export async function drilldownAction(
  granularity: PnlGranularity,
  period: string,
  displayLineKey: string
): Promise<DrilldownRow[]> {
  return getPnlDrilldown(granularity, period, displayLineKey);
}

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

/**
 * Add a dated expense to the P&L ledger (cost_entries). Generalizes the old
 * marketing-spend form: any non-order cost (marketing, tools, art purchases,
 * one-offs) books here at the date it occurred. channel/campaign are kept for
 * marketing entries. See sql/041_pnl_ledger.sql.
 */
export async function addCostEntryAction(formData: FormData) {
  const occurredOn = (formData.get('occurred_on') as string)?.trim();
  const category = (formData.get('category') as string)?.trim();
  const amountRaw = (formData.get('amount') as string)?.trim();
  const currency = ((formData.get('currency') as string) || 'EUR').trim();
  const description = (formData.get('description') as string)?.trim() || null;
  const channel = (formData.get('channel') as string)?.trim() || null;
  const campaign = (formData.get('campaign') as string)?.trim() || null;

  const amount = amountRaw ? parseFloat(amountRaw) : NaN;
  if (!occurredOn || !category || Number.isNaN(amount)) {
    throw new Error('An expense needs a date, a category and an amount.');
  }

  const { error } = await supabaseAdmin.from('cost_entries').insert({
    occurred_on: occurredOn,
    category,
    amount,
    currency,
    description,
    channel: category === 'marketing' ? channel : null,
    campaign: category === 'marketing' ? campaign : null,
    source: 'manual',
  });
  if (error) throw new Error(`Failed to add expense: ${error.message}`);

  revalidatePath('/economics');
}

export async function deleteCostEntryAction(id: string) {
  const { error } = await supabaseAdmin.from('cost_entries').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete expense: ${error.message}`);
  revalidatePath('/economics');
}

/**
 * Add a recurring subscription (Shopify plan, Vercel, AI tools). Expanded
 * into one monthly P&L entry each by the recurring_cost_entries view, so
 * editing amount/dates retroactively fixes history.
 */
export async function addRecurringCostAction(formData: FormData) {
  const name = (formData.get('name') as string)?.trim();
  const category = (formData.get('category') as string)?.trim();
  const monthlyRaw = (formData.get('monthly_amount') as string)?.trim();
  const activeFrom = (formData.get('active_from') as string)?.trim();
  const activeTo = (formData.get('active_to') as string)?.trim() || null;
  const currency = ((formData.get('currency') as string) || 'EUR').trim();

  const monthlyAmount = monthlyRaw ? parseFloat(monthlyRaw) : NaN;
  if (!name || !category || !activeFrom || Number.isNaN(monthlyAmount)) {
    throw new Error('A subscription needs a name, category, monthly amount and start date.');
  }

  const { error } = await supabaseAdmin.from('recurring_costs').insert({
    name,
    category,
    monthly_amount: monthlyAmount,
    currency,
    active_from: activeFrom,
    active_to: activeTo,
  });
  if (error) throw new Error(`Failed to add subscription: ${error.message}`);

  revalidatePath('/economics');
}

/** Edit a subscription's amount / end date in place (id bound by the form). */
export async function updateRecurringCostAction(id: string, formData: FormData) {
  const monthlyRaw = (formData.get('monthly_amount') as string)?.trim();
  const activeTo = (formData.get('active_to') as string)?.trim() || null;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), active_to: activeTo };
  if (monthlyRaw) {
    const monthlyAmount = parseFloat(monthlyRaw);
    if (!Number.isNaN(monthlyAmount)) update.monthly_amount = monthlyAmount;
  }

  const { error } = await supabaseAdmin.from('recurring_costs').update(update).eq('id', id);
  if (error) throw new Error(`Failed to update subscription: ${error.message}`);
  revalidatePath('/economics');
}

export async function deleteRecurringCostAction(id: string) {
  const { error } = await supabaseAdmin.from('recurring_costs').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete subscription: ${error.message}`);
  revalidatePath('/economics');
}
