/**
 * Estimate an artwork's one-time creation cost (Layer 1).
 *
 * When a candidate from the AI Art Generator is promoted to an artwork, its
 * creation cost is the sum of what it cost to make: the AI generation
 * (scaled up for the rejected candidates that were curated away), any
 * upscale run, and the mockup set. This reads the generated_images ledger
 * by image URL, sums the modelled per-generation cost, converts USD → the
 * reporting currency via finance_settings, and returns an itemised
 * breakdown suitable for artworks.creation_cost / creation_cost_breakdown.
 *
 * Best-effort: if the image can't be traced to a generation (e.g. an
 * imported Classic), it returns a zero-ai estimate so the operator can type
 * a purchase price in instead.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { CURATION_WASTE_MULTIPLIER, MOCKUP_SET_USD, UPSCALE_USD } from './pricing';
import { getFinanceSettings } from './economics';

export interface CreationCostEstimate {
  /** Total creation cost in the reporting currency (EUR by default). */
  creationCost: number;
  currency: string;
  breakdown: {
    ai_generation: number;
    upscale: number;
    mockups: number;
    purchase: number;
    manual_adjustment: number;
    source: 'estimate';
    fx_usd_to_eur: number;
  };
}

/**
 * Look up the generation that produced `imageUrl` and total its cost. The
 * generate route stamps `cost_usd` on the row; older rows only have
 * `metadata.estimatedCostUsd`, so we fall back to that.
 */
export async function estimateArtworkCreationCost(
  imageUrl: string | null
): Promise<CreationCostEstimate> {
  const fs = await getFinanceSettings();
  const fx = fs.creation_fx_usd_to_eur;
  const currency = fs.reporting_currency;

  const empty: CreationCostEstimate = {
    creationCost: 0,
    currency,
    breakdown: {
      ai_generation: 0,
      upscale: 0,
      mockups: 0,
      purchase: 0,
      manual_adjustment: 0,
      source: 'estimate',
      fx_usd_to_eur: fx,
    },
  };
  if (!imageUrl) return empty;

  const { data } = await supabaseAdmin
    .from('generated_images')
    .select('cost_usd, metadata')
    .eq('image_url', imageUrl)
    .maybeSingle();

  if (!data) return empty;

  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const genCostUsd =
    typeof data.cost_usd === 'number'
      ? data.cost_usd
      : typeof meta.estimatedCostUsd === 'number'
        ? (meta.estimatedCostUsd as number)
        : 0;

  // Scale the winning generation's cost for its share of curation waste.
  const aiUsd = genCostUsd * CURATION_WASTE_MULTIPLIER;

  // The image was upscaled for print if metadata carries an upscaled URL.
  const upscaleUsd =
    typeof meta.upscaledImageUrl === 'string' && meta.upscaledImageUrl.length > 0
      ? UPSCALE_USD
      : 0;

  // Every listed piece gets a mockup set; count it toward creation cost.
  const mockupsUsd = MOCKUP_SET_USD;

  const aiEur = round2(aiUsd * fx);
  const upscaleEur = round2(upscaleUsd * fx);
  const mockupsEur = round2(mockupsUsd * fx);

  return {
    creationCost: round2(aiEur + upscaleEur + mockupsEur),
    currency,
    breakdown: {
      ai_generation: aiEur,
      upscale: upscaleEur,
      mockups: mockupsEur,
      purchase: 0,
      manual_adjustment: 0,
      source: 'estimate',
      fx_usd_to_eur: fx,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
