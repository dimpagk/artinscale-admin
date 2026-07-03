/**
 * Meta ad-spend sync.
 *
 * Pulls yesterday's spend per campaign from the Meta Marketing API insights
 * endpoint (act_<AD_ACCOUNT_ID>/insights) and upserts it into
 * `marketing_spend`, the ledger the blended-CAC card on /economics reads
 * (sql/030_cost_tracking.sql). Each upserted row is then folded into
 * `cost_entries` under the same `marketing_spend:<id>` source_key scheme the
 * 041 backfill used, so the period P&L books the spend too.
 *
 * Idempotent on (spend_date, channel, campaign) via the unique index from
 * sql/045_marketing_spend_unique.sql: re-running the sync for the same day
 * refreshes the amount instead of duplicating the row. Meta finalizes
 * yesterday's numbers over the following hours, so the amount-on-conflict
 * update also lets a manual re-trigger later in the day pick up corrections.
 *
 * Required env:
 *   - META_AD_ACCOUNT_ID       numeric ad account id ("act_" prefix optional)
 *   - META_ADS_ACCESS_TOKEN    token with ads_read; falls back to
 *                              META_GRAPH_ACCESS_TOKEN if that token was
 *                              granted the scope
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/insights
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

const API_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v18.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Safety cap on paging.next hops; one test campaign fits in a single page. */
const MAX_PAGES = 10;

interface InsightsRow {
  spend?: string;
  campaign_name?: string;
  account_currency?: string;
  date_start?: string;
  date_stop?: string;
}

interface InsightsPage {
  data?: InsightsRow[];
  paging?: { next?: string };
}

export interface MetaSpendSyncResult {
  datePreset: string;
  campaigns: number;
  upserted: number;
  skippedZero: number;
  totalSpend: number;
  currency: string | null;
}

function getCreds(): { accountId: string; accessToken: string } {
  const rawAccount = process.env.META_AD_ACCOUNT_ID;
  if (!rawAccount) {
    throw new Error('META_AD_ACCOUNT_ID missing. Numeric ad account id from Meta Ads Manager.');
  }
  const accessToken =
    process.env.META_ADS_ACCESS_TOKEN ?? process.env.META_GRAPH_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error(
      'META_ADS_ACCESS_TOKEN missing (needs ads_read). META_GRAPH_ACCESS_TOKEN is used as a fallback if it carries the scope.'
    );
  }
  return { accountId: rawAccount.replace(/^act_/, ''), accessToken };
}

async function fetchInsightsPages(url: string): Promise<InsightsRow[]> {
  const rows: InsightsRow[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const res = await fetch(next);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta insights error ${res.status}: ${text}`);
    }
    const body = (await res.json()) as InsightsPage;
    rows.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  return rows;
}

/**
 * Pull yesterday's per-campaign spend and book it into marketing_spend and
 * cost_entries. Returns a summary for the cron response.
 */
export async function syncMetaAdSpend(): Promise<MetaSpendSyncResult> {
  const { accountId, accessToken } = getCreds();
  const datePreset = 'yesterday';

  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'spend,campaign_name,account_currency',
    date_preset: datePreset,
    limit: '100',
    access_token: accessToken,
  });
  const rows = await fetchInsightsPages(`${BASE}/act_${accountId}/insights?${params}`);

  let skippedZero = 0;
  const spendRows = rows.flatMap((row) => {
    const amount = Math.round(Number(row.spend ?? '0') * 100) / 100;
    if (!row.date_start || !Number.isFinite(amount)) return [];
    if (amount === 0) {
      // Campaigns listed with no delivery yesterday; booking them would only
      // clutter the ledger.
      skippedZero++;
      return [];
    }
    return [
      {
        spend_date: row.date_start,
        channel: 'meta',
        campaign: row.campaign_name ?? '(no campaign)',
        amount,
        currency: row.account_currency ?? 'EUR',
        notes: 'auto: meta insights sync',
      },
    ];
  });

  if (spendRows.length === 0) {
    return {
      datePreset,
      campaigns: rows.length,
      upserted: 0,
      skippedZero,
      totalSpend: 0,
      currency: null,
    };
  }

  const { data: upserted, error } = await supabaseAdmin
    .from('marketing_spend')
    .upsert(spendRows, { onConflict: 'spend_date,channel,campaign' })
    .select('id, spend_date, channel, campaign, amount, currency, notes');
  if (error) throw new Error(`Failed to upsert marketing_spend: ${error.message}`);

  // Fold into the dated expense ledger so the P&L sees ongoing ad spend, not
  // just what the 041 backfill captured. Same source_key scheme, so a re-run
  // corrects the entry instead of appending.
  const costEntries = (upserted ?? []).map((r) => ({
    occurred_on: r.spend_date,
    category: 'marketing',
    amount: r.amount,
    currency: r.currency,
    description: r.notes,
    channel: r.channel,
    campaign: r.campaign,
    source: 'auto',
    source_key: `marketing_spend:${r.id}`,
  }));
  if (costEntries.length > 0) {
    const { error: costError } = await supabaseAdmin
      .from('cost_entries')
      .upsert(costEntries, { onConflict: 'source_key' });
    if (costError) throw new Error(`Failed to upsert cost_entries: ${costError.message}`);
  }

  return {
    datePreset,
    campaigns: rows.length,
    upserted: spendRows.length,
    skippedZero,
    totalSpend: Math.round(spendRows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100,
    currency: spendRows[0]?.currency ?? null,
  };
}
