/**
 * FX rates from the ECB open API.
 *
 * The P&L converts USD spend (AI generation, USD tool invoices) to EUR at
 * the daily ECB reference rate for the event date (see sql/041_pnl_ledger).
 * This module fetches the ECB USD/EUR series and upserts it into `fx_rates`.
 *
 * The ECB quotes USD per 1 EUR (e.g. 1 EUR = 1.14 USD). We store the
 * INVERSE, so `fx_rates.rate` is the EUR value of 1 USD — the multiplier a
 * USD amount needs. Rates are published on TARGET business days only; the
 * pnl_entries view takes the most recent rate on or before each event date.
 *
 * Two modes:
 *   - incremental (default): last ~10 observations, run daily by the
 *     fx_sync cron. Self-heals short gaps.
 *   - full: the whole series from the first generated_images date, run once
 *     via scripts/backfill-fx-rates.mjs so historical conversions are right.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

const ECB_SERIES_URL =
  'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A';

/** Earliest date to backfill from if there is no generation history yet. */
const FALLBACK_START = '2026-05-01';

export interface FxObservation {
  /** ISO date (YYYY-MM-DD) of the ECB reference rate. */
  date: string;
  /** EUR value of 1 USD (already inverted from the ECB USD-per-EUR quote). */
  rate: number;
}

export interface FxSyncResult {
  mode: 'incremental' | 'full';
  fetched: number;
  upserted: number;
  from: string | null;
  to: string | null;
}

/**
 * Parse the ECB `jsondata` payload into observations. The series values are
 * USD per 1 EUR keyed by an index into structure.dimensions.observation
 * time periods; we invert to EUR per 1 USD and drop any gaps (ECB marks
 * missing days as null).
 */
export function parseEcbSeries(payload: unknown): FxObservation[] {
  const root = payload as {
    dataSets?: Array<{ series?: Record<string, { observations?: Record<string, Array<number | null>> }> }>;
    structure?: { dimensions?: { observation?: Array<{ values?: Array<{ id?: string }> }> } };
  };

  const timeValues = root.structure?.dimensions?.observation?.[0]?.values ?? [];
  const series = root.dataSets?.[0]?.series ?? {};
  const firstSeriesKey = Object.keys(series)[0];
  const observations = firstSeriesKey ? series[firstSeriesKey]?.observations ?? {} : {};

  const out: FxObservation[] = [];
  for (const [indexStr, values] of Object.entries(observations)) {
    const date = timeValues[Number(indexStr)]?.id;
    const usdPerEur = values?.[0];
    if (!date || typeof usdPerEur !== 'number' || usdPerEur <= 0) continue;
    out.push({ date, rate: round6(1 / usdPerEur) });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

async function fetchEcb(url: string): Promise<FxObservation[]> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`ECB API returned ${res.status} ${res.statusText}`);
  }
  return parseEcbSeries(await res.json());
}

/** First generation date, so a full backfill covers all USD spend. */
async function earliestGenerationDate(): Promise<string> {
  const { data } = await supabaseAdmin
    .from('generated_images')
    .select('created_at')
    .not('cost_usd', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const raw = (data as { created_at?: string } | null)?.created_at;
  return raw ? raw.slice(0, 10) : FALLBACK_START;
}

/**
 * Fetch ECB USD/EUR rates and upsert them into fx_rates. Returns how many
 * observations were fetched and written.
 */
export async function syncFxRates(opts: { full?: boolean } = {}): Promise<FxSyncResult> {
  const mode: 'incremental' | 'full' = opts.full ? 'full' : 'incremental';

  const url = opts.full
    ? `${ECB_SERIES_URL}?format=jsondata&startPeriod=${await earliestGenerationDate()}`
    : `${ECB_SERIES_URL}?format=jsondata&lastNObservations=10`;

  const observations = await fetchEcb(url);
  if (observations.length === 0) {
    return { mode, fetched: 0, upserted: 0, from: null, to: null };
  }

  const rows = observations.map((o) => ({
    rate_date: o.date,
    base_currency: 'USD',
    quote_currency: 'EUR',
    rate: o.rate,
    fetched_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('fx_rates')
    .upsert(rows, { onConflict: 'rate_date,base_currency,quote_currency' });
  if (error) throw new Error(`Failed to upsert fx_rates: ${error.message}`);

  return {
    mode,
    fetched: observations.length,
    upserted: rows.length,
    from: observations[0].date,
    to: observations[observations.length - 1].date,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
