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
import type { ArtworkCreationSource } from '@/lib/types';
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

/**
 * Map an artist's kind (migration 027 taxonomy) to a creation source.
 * The artist's kind is authoritative over the form's guess, so a piece by a
 * community artist is always sourced 'community', a Classic 'public_domain',
 * a studio persona 'ai'.
 */
function sourceForArtistKind(
  kind: string | null,
  fallback: ArtworkCreationSource
): ArtworkCreationSource {
  switch (kind) {
    case 'community':
      return 'community';
    case 'classic':
      return 'public_domain';
    case 'studio':
      return 'ai';
    default:
      return fallback;
  }
}

export interface ResolvedCreationCost {
  source: ArtworkCreationSource;
  cost: number | null;
  currency: string;
  breakdown: Record<string, unknown>;
}

/**
 * Resolve the creation source + cost for an artwork on save.
 *
 *   - An operator-entered cost always wins (recorded as a manual adjustment).
 *   - Otherwise prefill by source: AI estimates from the generation ledger,
 *     community uses the configurable default flat fee (varies per piece, so
 *     it's a starting point), public-domain is free.
 *
 * The source is derived from the assigned artist's kind when there is one,
 * falling back to the form's selection.
 */
export async function resolveCreationCost(args: {
  imageUrl: string | null;
  artistId: string | null;
  providedCost: number | null;
  formSource: ArtworkCreationSource;
}): Promise<ResolvedCreationCost> {
  const fs = await getFinanceSettings();
  const currency = fs.reporting_currency;

  let artistKind: string | null = null;
  if (args.artistId) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('artist_kind')
      .eq('id', args.artistId)
      .maybeSingle();
    artistKind = (data as { artist_kind?: string | null } | null)?.artist_kind ?? null;
  }
  const source = sourceForArtistKind(artistKind, args.formSource);

  // Operator-entered value wins.
  if (args.providedCost != null) {
    return {
      source,
      cost: args.providedCost,
      currency,
      breakdown: { manual_adjustment: args.providedCost, source: 'operator' },
    };
  }

  if (source === 'ai') {
    const est = await estimateArtworkCreationCost(args.imageUrl);
    return { source, cost: est.creationCost, currency, breakdown: est.breakdown };
  }

  if (source === 'community') {
    const fee = fs.default_community_artist_fee;
    return {
      source,
      cost: fee,
      currency,
      breakdown: { community_fee: fee, source: 'default', note: 'varies per artwork' },
    };
  }

  if (source === 'public_domain') {
    return {
      source,
      cost: 0,
      currency,
      breakdown: { purchase: 0, source: 'public_domain' },
    };
  }

  // 'purchased' / 'manual' with no entered value — leave null for the
  // operator to fill.
  return { source, cost: null, currency, breakdown: {} };
}
