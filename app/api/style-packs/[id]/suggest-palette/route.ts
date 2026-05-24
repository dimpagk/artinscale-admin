import { NextResponse } from 'next/server'
import { getAnthropic, DEFAULT_MODEL } from '@/lib/agents/base'
import { fetchStylePackFromDb } from '@/lib/style-packs/db'
import { getStylePack } from '@/lib/style-packs'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Pull dominant hex codes from this style pack's recent ★ exemplars.
 *
 * GET /api/style-packs/{id}/suggest-palette
 *
 * Returns: { suggestions: ['#RRGGBB', ...], exemplarCount }
 *
 * The operator reviews and chooses which to add — never auto-injects
 * into the locked palette, since a hallucinated hex would corrupt the
 * artist's voice for every future generation.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const pack = (await fetchStylePackFromDb(id)) ?? getStylePack(id)
  if (!pack) {
    return NextResponse.json({ error: 'Style pack not found' }, { status: 404 })
  }

  const { data: exemplars } = await supabaseAdmin
    .from('generated_images')
    .select('image_url')
    .eq('metadata->>stylePackId', id)
    .eq('metadata->>exemplar', 'true')
    .order('metadata->>exemplarMarkedAt', { ascending: false, nullsFirst: false })
    .limit(4)

  const exemplarUrls = (exemplars ?? []).map((row) => (row as { image_url: string }).image_url)
  if (exemplarUrls.length === 0) {
    return NextResponse.json({
      suggestions: [],
      exemplarCount: 0,
      message: 'No exemplars marked yet. Star some images in the gallery first.',
    })
  }

  const client = getAnthropic()
  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: [
          ...exemplarUrls.map((url) => ({
            type: 'image' as const,
            source: { type: 'url' as const, url },
          })),
          {
            type: 'text',
            text: [
              `These are ${exemplarUrls.length} exemplar image(s) for the artist "${pack.persona.name}" (${pack.persona.tagline}).`,
              `Their existing locked palette is: ${pack.palette.colors.join(', ')}.`,
              '',
              'Read each image and identify the actual dominant hex codes (sample the pixels — do not guess).',
              'Return up to 6 most-dominant hex codes across all images, deduplicated, in #RRGGBB format.',
              `Skip any hex that is already within ~10% of an existing palette color above.`,
              '',
              'Return JSON only, no prose:',
              '{"suggestions": ["#RRGGBB", ...]}',
            ].join('\n'),
          },
        ],
      },
    ],
  })

  const textBlock = message.content.find((c) => c.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return NextResponse.json({ error: 'Vision call returned no text' }, { status: 500 })
  }
  const fenced = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/)
  let parsed: { suggestions?: string[] }
  try {
    parsed = JSON.parse((fenced ? fenced[1] : textBlock.text).trim())
  } catch {
    return NextResponse.json(
      { error: 'Could not parse Claude output as JSON', raw: textBlock.text },
      { status: 500 }
    )
  }

  const suggestions = (parsed.suggestions ?? []).filter((s): s is string =>
    typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
  )

  return NextResponse.json({
    suggestions,
    exemplarCount: exemplarUrls.length,
  })
}
