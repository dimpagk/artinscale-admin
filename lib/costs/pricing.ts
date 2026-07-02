/**
 * Cost rate card for the creation pipeline.
 *
 * These are the per-operation API costs the studio pays to bring an
 * artwork into existence. They are ESTIMATES — Gemini/Replicate/Anthropic
 * bill in USD and don't hand us an exact per-call figure in the response,
 * so we model it here and stamp `cost_source='estimated'`. When we later
 * wire real token/usage accounting, actuals override these and flip
 * `cost_source='actual'`.
 *
 * Centralised so the numbers live in one place instead of being scattered
 * as inline literals across the generate / upscale / mockup routes.
 * Adjust here when a provider changes pricing.
 */

import type { ModelKey } from '@/lib/constants/art-generator';

/** USD per generated image, by model tier (Nano Banana 2 family). */
export const IMAGE_GENERATION_USD: Record<ModelKey, number> = {
  lite: 0.02,
  flash: 0.04,
  pro: 0.12,
};

/** USD for the Claude vision style-similarity pass (only when a style pack is used). */
export const STYLE_SIMILARITY_USD = 0.02;

/** USD for the Claude vision visual-tagger pass (runs on every generation). */
export const VISUAL_TAGGER_USD = 0.01;

/** USD for one Real-ESRGAN upscale run (Replicate), used to reach print DPI. */
export const UPSCALE_USD = 0.1;

/**
 * USD for a full 6-image mockup set (original + 3 detail crops + framed
 * close-up + in-room composite). One-off per artwork. See MOCKUP_PIPELINE.md
 * (~$0.60 measured on the 2026-05-09 batch).
 */
export const MOCKUP_SET_USD = 0.6;

/**
 * Curation multiplier. The honest creation cost of a *kept* piece includes
 * the generations that were rejected to get it. At the plan's assumed ~70%
 * rejection rate, roughly 3 candidates are burned per keeper, so the
 * winning generation's direct cost is scaled up to account for its share of
 * the waste. Set to 1 to count only the winning generation's own cost.
 */
export const CURATION_WASTE_MULTIPLIER = 3;

/** Cost in USD of a single generation call (image + the vision passes it triggers). */
export function estimateGenerationCostUsd(args: {
  model: ModelKey;
  usedStylePack: boolean;
}): number {
  const image = IMAGE_GENERATION_USD[args.model] ?? IMAGE_GENERATION_USD.flash;
  const similarity = args.usedStylePack ? STYLE_SIMILARITY_USD : 0;
  return round6(image + similarity + VISUAL_TAGGER_USD);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
