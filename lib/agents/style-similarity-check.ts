/**
 * Style similarity check.
 *
 * Pre-queue filter: when a new generated_image is produced via a
 * style pack, compare it against the operator's recently-approved
 * outputs for that same pack. If the divergence looks high, mark
 * the image with a metadata flag so the curator's UI can surface
 * a warning.
 *
 * Implementation: uses Claude's vision capability with a "rate
 * adherence" prompt over the candidate + up to 3 prior approved
 * exemplars. Cheap, no separate vision API needed. Beyond the overall
 * score it also returns a separate MEDIUM-fidelity score (does the piece
 * read as the pack's actual painting medium, not an excluded one) and
 * `fixInstructions` — concrete corrections the auto-refine pass
 * (lib/agents/style-refine.ts) can apply without changing composition.
 *
 * This is a *signal*, not a hard block. The curator still sees
 * everything; the score just sharpens attention and drives auto-refine.
 */

import { getAnthropic, DEFAULT_MODEL, extractJson } from './base'
import { getStylePack } from '@/lib/style-packs'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface StyleSimilarityResult {
  score: number  // 0-1, higher = more on-style
  rationale: string
  suggestedAction: 'keep' | 'review' | 'reject'
  /**
   * How well the piece reads as the pack's *medium* — the painting/drawing
   * medium named in the master prompt (e.g. "illustrative oil, visible
   * brushwork"), as opposed to drifting into an excluded medium from the
   * negative list (flat vector, photoreal, watercolor). 0-1, higher = truer
   * to the medium. Scored separately because a piece can be on-palette and
   * on-composition yet render in the wrong medium.
   */
  mediumScore: number
  /** One sentence on the medium read. */
  mediumNote: string
  /**
   * Concrete, imperative corrections a downstream image-edit pass can apply
   * WITHOUT changing the subject or composition — e.g. "rebuild the surface
   * as visible oil brushwork, remove the flat vector edges." Null when the
   * piece is already on-voice and no correction is warranted.
   */
  fixInstructions: string | null
}

function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

export async function checkStyleSimilarity(args: {
  candidateImageUrl: string
  stylePackId: string
}): Promise<StyleSimilarityResult> {
  const pack = getStylePack(args.stylePackId)
  if (!pack) {
    throw new Error(`Unknown style pack ${args.stylePackId}`)
  }

  // Fetch up to 3 operator-marked exemplars for this style pack. If
  // none exist yet (early launch), fall back to images that were at
  // least promoted to artworks (artwork_id is set).
  let goodExemplars: Array<{ image_url: string }> = []

  const { data: marked } = await supabaseAdmin
    .from('generated_images')
    .select('image_url')
    .eq('metadata->>stylePackId', args.stylePackId)
    .eq('metadata->>exemplar', 'true')
    .order('metadata->>exemplarMarkedAt', { ascending: false, nullsFirst: false })
    .limit(3)

  goodExemplars = (marked ?? []) as Array<{ image_url: string }>

  if (goodExemplars.length === 0) {
    const { data: linked } = await supabaseAdmin
      .from('generated_images')
      .select('image_url')
      .eq('metadata->>stylePackId', args.stylePackId)
      .not('artwork_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3)
    goodExemplars = (linked ?? []) as Array<{ image_url: string }>
  }

  const client = getAnthropic()
  const exemplarBlocks = goodExemplars.map((e) => ({
    type: 'image' as const,
    source: { type: 'url' as const, url: (e as { image_url: string }).image_url },
  }))

  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 700,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Style pack: ${pack.persona.name}: ${pack.persona.tagline}`,
              `Master prompt (defines the voice AND the medium): ${pack.prompt.master}`,
              `Locked palette: ${pack.palette.colors.join(', ')}`,
              `Composition rules: ${pack.composition.notes}`,
              `Never drift into (negative / excluded mediums): ${pack.prompt.negative}`,
              '',
              goodExemplars.length > 0
                ? `Below: ${goodExemplars.length} exemplar image(s) the operator has previously approved for this style, then the candidate image (last).`
                : 'No exemplars available yet: score the candidate against the style description alone.',
              '',
              'Judge the candidate on two axes:',
              '1. Overall adherence to the artist voice (palette, composition discipline, negative space, line/shape language).',
              '2. MEDIUM FIDELITY: does it genuinely read as the medium named in the master prompt (its real surface: brushwork, grain, edge quality) and NOT as an excluded medium from the negative list? Weight this heavily.',
              '',
              'If it falls short, write fixInstructions: concrete imperative corrections an image editor can apply to THIS image WITHOUT changing the subject, pose, or composition (e.g. rebuild the surface as visible oil brushwork, kill the flat vector edges, warm the neon so it reads as light not a hard outline). Under 60 words. Use null if the piece is already on-voice.',
              '',
              'Return ONLY JSON: {"score": <0..1>, "mediumScore": <0..1>, "mediumNote": "one sentence", "rationale": "one sentence", "suggestedAction": "keep" | "review" | "reject", "fixInstructions": "..." | null}',
            ].join('\n'),
          },
          ...exemplarBlocks,
          {
            type: 'image',
            source: { type: 'url', url: args.candidateImageUrl },
          },
        ],
      },
    ],
  })

  const textBlock = message.content.find((c) => c.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic returned no text content for similarity check.')
  }

  const raw = extractJson<Partial<StyleSimilarityResult>>(textBlock.text)
  const action = raw.suggestedAction
  return {
    score: clamp01(raw.score),
    mediumScore: clamp01(raw.mediumScore ?? raw.score),
    mediumNote: typeof raw.mediumNote === 'string' ? raw.mediumNote : '',
    rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
    suggestedAction:
      action === 'keep' || action === 'review' || action === 'reject' ? action : 'review',
    fixInstructions:
      typeof raw.fixInstructions === 'string' && raw.fixInstructions.trim().length > 0
        ? raw.fixInstructions.trim()
        : null,
  }
}
