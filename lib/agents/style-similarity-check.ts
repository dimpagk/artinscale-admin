/**
 * Style similarity check.
 *
 * Pre-queue filter: when a new generated_image is produced via a
 * style pack, compare it against the operator's recently-approved
 * outputs for that same pack. If the divergence looks high, mark
 * the image with a metadata flag so the curator's UI can surface
 * a warning.
 *
 * Implementation: uses Claude's vision capability with a simple
 * "rate adherence" prompt over the candidate + 3 prior approved
 * exemplars. Cheap, no separate vision API needed.
 *
 * This is a *signal* — not a hard block. The curator still sees
 * everything; the warning just sharpens attention.
 */

import { getAnthropic, DEFAULT_MODEL } from './base'
import { getStylePack } from '@/lib/style-packs'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface StyleSimilarityResult {
  score: number  // 0-1, higher = more on-style
  rationale: string
  suggestedAction: 'keep' | 'review' | 'reject'
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
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Style pack: ${pack.persona.name} — ${pack.persona.tagline}`,
              `Master prompt: ${pack.prompt.master}`,
              `Locked palette: ${pack.palette.colors.join(', ')}`,
              `Composition rules: ${pack.composition.notes}`,
              '',
              goodExemplars.length > 0
                ? `Below: ${goodExemplars.length} exemplar image(s) the operator has previously approved for this style, then the candidate image.`
                : 'No exemplars available yet — score the candidate against the style description alone.',
              '',
              'Rate the candidate image\'s adherence to this style on a 0-1 scale.',
              'Return JSON: {"score": <0..1>, "rationale": "...one sentence...", "suggestedAction": "keep" | "review" | "reject"}',
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

  const fenced = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : textBlock.text
  return JSON.parse(candidate.trim()) as StyleSimilarityResult
}
