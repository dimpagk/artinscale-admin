/**
 * Visual content tagger — uses Claude vision to classify a generated
 * image's subject / mood / composition / dominant colors.
 *
 * Runs fire-and-forget after generation so the result lands on the
 * `generated_images.metadata.tags` field shortly after the operator
 * sees the image. Cost: ~$0.01 per call. Failure is silent — tagging
 * is best-effort, never blocks generation.
 *
 * The tags fuel:
 *   - Gallery filtering ("show me Atlas's portraits")
 *   - Future style-pack tuning ("Maya generations are skewing dramatic
 *     when we want serene — adjust the master prompt")
 *   - The recommendation engine on the storefront, eventually
 */

import { getAnthropic, DEFAULT_MODEL } from './base'

export type SubjectKind = 'portrait' | 'figure' | 'landscape' | 'object' | 'abstract' | 'unknown'
export type MoodTag = 'serene' | 'dramatic' | 'vibrant' | 'moody' | 'ethereal' | 'bold' | 'tender'
export type CompositionTag = 'centered' | 'rule_of_thirds' | 'symmetric' | 'asymmetric' | 'minimal' | 'busy'

export interface VisualTags {
  subjectKind: SubjectKind
  moods: MoodTag[]
  composition: CompositionTag[]
  dominantHexCodes: string[]
  oneLineDescription: string
}

const SYSTEM_PROMPT = `You classify a single AI-generated artwork along several axes. Read the image and return JSON only — no prose.

Schema:
{
  "subjectKind": "portrait" | "figure" | "landscape" | "object" | "abstract" | "unknown",
  "moods": ["serene" | "dramatic" | "vibrant" | "moody" | "ethereal" | "bold" | "tender", ...],   // 1-3 entries
  "composition": ["centered" | "rule_of_thirds" | "symmetric" | "asymmetric" | "minimal" | "busy", ...],   // 1-2 entries
  "dominantHexCodes": ["#RRGGBB", ...],   // 3-5 entries, sampled from actual pixels
  "oneLineDescription": "..."             // 12 words max, factual not poetic
}

If you cannot classify, return "unknown" for subjectKind and an empty array for the others — do not invent.`

export async function tagVisualContent(args: {
  imageUrl: string
}): Promise<VisualTags> {
  const client = getAnthropic()
  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: args.imageUrl } },
          { type: 'text', text: 'Classify and return JSON now.' },
        ],
      },
    ],
  })

  const textBlock = message.content.find((c) => c.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Visual tagger returned no text content.')
  }
  const fenced = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : textBlock.text
  const parsed = JSON.parse(candidate.trim()) as Partial<VisualTags>

  return {
    subjectKind: (parsed.subjectKind as SubjectKind) ?? 'unknown',
    moods: Array.isArray(parsed.moods) ? (parsed.moods as MoodTag[]).slice(0, 3) : [],
    composition: Array.isArray(parsed.composition)
      ? (parsed.composition as CompositionTag[]).slice(0, 2)
      : [],
    dominantHexCodes: Array.isArray(parsed.dominantHexCodes)
      ? (parsed.dominantHexCodes as string[]).filter((s) => /^#[0-9a-fA-F]{6}$/.test(s)).slice(0, 5)
      : [],
    oneLineDescription:
      typeof parsed.oneLineDescription === 'string'
        ? parsed.oneLineDescription.slice(0, 200)
        : '',
  }
}
