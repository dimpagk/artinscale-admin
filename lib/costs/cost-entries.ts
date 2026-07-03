/**
 * Write path for the dated expense ledger (sql/041_pnl_ledger.sql).
 *
 * Two writers:
 *   - syncArtworkCostEntries: called on artwork save. Turns the resolved
 *     creation-cost breakdown into dated cost_entries rows so the P&L books
 *     creation spend at the date incurred. Upserts by a stable source_key so
 *     re-saving corrects the entry instead of duplicating it, and deletes a
 *     component's row when it drops to zero.
 *   - the manual expense + subscription forms on /economics write directly.
 *
 * The AI-generation component is deliberately NOT written here: actual
 * per-image generation spend is booked from generated_images in the
 * pnl_entries view, so writing it again would double-count.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ArtworkCreationSource } from '@/lib/types';

/** cost_entries categories (mirror the SQL CHECK constraint). */
export type CostCategory =
  | 'creation_processing'
  | 'creation_purchase'
  | 'royalty_flat'
  | 'marketing'
  | 'tools_shopify'
  | 'tools_gelato'
  | 'tools_vercel'
  | 'tools_ai'
  | 'tools_other'
  | 'shipping_other'
  | 'other';

/** recurring_costs categories (subscriptions are tools/other only). */
export type RecurringCategory =
  | 'tools_shopify'
  | 'tools_gelato'
  | 'tools_vercel'
  | 'tools_ai'
  | 'tools_other'
  | 'other';

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Book the non-AI components of an artwork's creation cost as dated ledger
 * entries. Idempotent per (artwork, component): preserves the original
 * `occurred_on` on later edits, refreshes the amount, and removes a
 * component row when its amount falls to zero.
 */
export async function syncArtworkCostEntries(args: {
  artworkId: string;
  source: ArtworkCreationSource;
  breakdown: Record<string, unknown>;
  currency: string;
}): Promise<void> {
  const b = args.breakdown ?? {};

  // Map the breakdown into the P&L component amounts (same rule as the
  // migration-041 backfill). ai_generation is excluded on purpose.
  const processing = round2(num(b.upscale) + num(b.mockups));
  const purchase = round2(
    num(b.purchase) + (args.source !== 'ai' ? num(b.manual_adjustment) : 0)
  );
  const royaltyFlat = round2(num(b.community_fee));

  const components: Array<{ key: string; category: CostCategory; amount: number; description: string }> = [
    { key: 'processing', category: 'creation_processing', amount: processing, description: 'Upscale + mockups' },
    { key: 'purchase', category: 'creation_purchase', amount: purchase, description: 'Art purchase / license' },
    { key: 'royalty_flat', category: 'royalty_flat', amount: royaltyFlat, description: 'Community artist flat fee' },
  ];

  const sourceKeys = components.map((c) => `artwork:${args.artworkId}:${c.key}`);

  // Preserve the accounting date across edits: read existing rows first.
  const { data: existing } = await supabaseAdmin
    .from('cost_entries')
    .select('source_key, occurred_on')
    .in('source_key', sourceKeys);
  const existingByKey = new Map<string, string>(
    (existing ?? []).map((r) => [r.source_key as string, r.occurred_on as string])
  );

  const today = new Date().toISOString().slice(0, 10);
  const toUpsert: Array<Record<string, unknown>> = [];
  const toDelete: string[] = [];

  for (const c of components) {
    const sourceKey = `artwork:${args.artworkId}:${c.key}`;
    if (c.amount > 0) {
      toUpsert.push({
        occurred_on: existingByKey.get(sourceKey) ?? today,
        category: c.category,
        amount: c.amount,
        currency: args.currency,
        description: c.description,
        artwork_id: args.artworkId,
        source: 'auto',
        source_key: sourceKey,
      });
    } else if (existingByKey.has(sourceKey)) {
      toDelete.push(sourceKey);
    }
  }

  if (toUpsert.length > 0) {
    const { error } = await supabaseAdmin
      .from('cost_entries')
      .upsert(toUpsert, { onConflict: 'source_key' });
    if (error) throw new Error(`Failed to write artwork cost entries: ${error.message}`);
  }
  if (toDelete.length > 0) {
    const { error } = await supabaseAdmin
      .from('cost_entries')
      .delete()
      .in('source_key', toDelete);
    if (error) throw new Error(`Failed to prune artwork cost entries: ${error.message}`);
  }
}
