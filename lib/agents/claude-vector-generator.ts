/**
 * Direct vector generation via Claude.
 *
 * Bypasses Gemini entirely — Claude writes SVG markup as text. Native
 * vector output, infinite resolution, immediately layered (we group
 * paths via `<g id="..."></g>` blocks so the layer panel sees
 * meaningful groupings from the start).
 *
 * Best fits for this approach:
 *   - Vera Prime (Bauhaus geometry) — excellent
 *   - Atlas Linework (bold contour) — good
 *   - Maya Riso (risograph + halftone grain) — weak; halftone needs raster
 *
 * The style pack itself decides whether direct vector mode is offered
 * (`stylePack.directVectorEnabled`). The PromptBuilder shows the
 * engine toggle only for packs that opt in.
 */

import { getAnthropic, REASONING_MODEL } from './base'
import type { StylePack } from '@/lib/style-packs'

const SYSTEM_PROMPT = `You are an SVG-native AI artist. You output ONLY raw SVG markup — no prose, no code fences, no commentary, no \`\`\`xml or \`\`\`svg fences.

Rules:
- Output a single, parseable <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"> ... </svg> document.
- Use only the hex colors specified in the palette. No gradients. No filters. No external assets. No raster <image> elements.
- Group meaningful regions with <g id="background"|"midground"|"subject"|"accent"> so the operator can toggle layers later.
- Each <path> must have a fill="#RRGGBB" attribute drawn from the palette.
- Composition must respect the rules in the style brief.
- Output dimensions: 1024 × 1024 viewBox. No fixed width/height attributes — the SVG should scale.
- Keep total path count under 200. Prefer expressive simplicity over complexity.

Your output is parsed by an SVG renderer. Anything outside the <svg>...</svg> root will break parsing.`

export interface ClaudeVectorResult {
  svg: string
  /** Detected hex colors used in the SVG */
  paletteUsed: string[]
}

export async function generateVectorWithClaude(args: {
  stylePack: StylePack
  subject: string
  contributionContext?: string
}): Promise<ClaudeVectorResult> {
  const { stylePack, subject, contributionContext } = args

  const userPrompt = [
    `Artist: ${stylePack.persona.name} — ${stylePack.persona.tagline}`,
    `Process: ${stylePack.persona.processMd}`,
    '',
    `Style master prompt:\n${stylePack.prompt.master}`,
    '',
    `Avoid: ${stylePack.prompt.negative}`,
    '',
    `Locked palette (use ONLY these hex codes): ${stylePack.palette.colors.join(', ')}`,
    `Palette usage: ${stylePack.palette.description}`,
    '',
    `Composition: ${stylePack.composition.subjectPlacement} · max ${stylePack.composition.maxSubjects} primary subject(s) · ${stylePack.composition.notes}`,
    '',
    `Subject: ${subject}`,
    contributionContext
      ? `\nCommunity context (use as inspiration, do not depict literally): ${contributionContext}`
      : '',
    '',
    'Generate the SVG now.',
  ]
    .filter(Boolean)
    .join('\n')

  const client = getAnthropic()
  const message = await client.messages.create({
    model: REASONING_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = message.content.find((c) => c.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content for vector generation.')
  }

  const svg = extractSvg(textBlock.text)
  const paletteUsed = extractFills(svg)

  return { svg, paletteUsed }
}

/**
 * Pull the <svg>...</svg> document out of Claude's response, even
 * though the system prompt says "no prose" — defensive parsing.
 */
function extractSvg(raw: string): string {
  // Strip code fences if Claude added them despite instructions
  const fenced = raw.match(/```(?:svg|xml)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : raw

  const svgMatch = candidate.match(/<svg\b[\s\S]*?<\/svg>/)
  if (!svgMatch) {
    throw new Error(
      `Claude's output did not contain a <svg>...</svg> root. First 300 chars: ${raw.slice(0, 300)}`
    )
  }
  return svgMatch[0]
}

function extractFills(svg: string): string[] {
  const fills = new Set<string>()
  for (const m of svg.matchAll(/\bfill=(?:"|')(#[0-9a-fA-F]{6})(?:"|')/g)) {
    fills.add(m[1].toLowerCase())
  }
  return [...fills]
}
