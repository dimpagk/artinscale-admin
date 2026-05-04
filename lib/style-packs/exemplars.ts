/**
 * Approved-exemplar lookup for a style pack.
 *
 * Replaces / supplements the static `referenceAssetPaths` on each
 * StylePack JSON. Once an operator marks images via
 * `POST /api/art-generator/{id}/exemplar`, those images become the
 * source of truth for "what does this artist's voice look like?" —
 * fed to:
 *
 *   - the generate route as Gemini reference-image inlineData parts
 *   - the style similarity check as exemplars to compare against
 *
 * Strategy: prefer DB-marked exemplars over the JSON `referenceAssetPaths`
 * — the JSON list is a launch-day fallback that the operator can grow
 * past once they've curated real keepers.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'

export interface Exemplar {
  imageUrl: string
  promptHint: string | null
  source: 'approved' | 'static_fallback'
}

const MAX_EXEMPLARS = 4

export async function loadExemplars(args: {
  stylePackId: string
  staticFallbackPaths?: string[]
  baseUrlForStaticPaths?: string
}): Promise<Exemplar[]> {
  const { data } = await supabaseAdmin
    .from('generated_images')
    .select('image_url, prompt')
    .eq('metadata->>stylePackId', args.stylePackId)
    .eq('metadata->>exemplar', 'true')
    .order('metadata->>exemplarMarkedAt', { ascending: false, nullsFirst: false })
    .limit(MAX_EXEMPLARS)

  const approved: Exemplar[] = (data ?? []).map((row) => {
    const r = row as { image_url: string; prompt: string | null }
    return {
      imageUrl: r.image_url,
      promptHint: r.prompt,
      source: 'approved',
    }
  })

  if (approved.length >= MAX_EXEMPLARS) return approved

  const fillerNeeded = MAX_EXEMPLARS - approved.length
  const fallbackPaths = (args.staticFallbackPaths ?? []).slice(0, fillerNeeded)
  const fallback: Exemplar[] = fallbackPaths.map((path) => ({
    imageUrl: path.startsWith('http')
      ? path
      : `${args.baseUrlForStaticPaths ?? ''}/${path.replace(/^\/+/, '')}`,
    promptHint: null,
    source: 'static_fallback',
  }))

  return [...approved, ...fallback]
}
