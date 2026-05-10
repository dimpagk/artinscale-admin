/**
 * AI Art Generator Constants
 *
 * Types, style presets, model configuration, and aspect ratios
 * for the Gemini-powered AI art generation feature.
 */

// ============================================
// Model Configuration
// ============================================

export const MODEL_OPTIONS = [
  {
    key: 'flash',
    label: 'Nano Banana 2 (Fast)',
    modelId: 'gemini-2.5-flash-image',
    description: 'Fast generation, good for iteration',
  },
  {
    key: 'pro',
    label: 'Nano Banana Pro (Quality)',
    modelId: 'nano-banana-pro-preview',
    description: 'Studio-quality output, slower',
  },
] as const

export type ModelKey = (typeof MODEL_OPTIONS)[number]['key']

// ============================================
// Style Presets
// ============================================

export const STYLE_PRESETS = [
  { key: 'photorealistic', label: 'Photorealistic', modifier: 'photorealistic, highly detailed, 8K quality' },
  { key: 'oil-painting', label: 'Oil Painting', modifier: 'oil painting on canvas, rich textures, visible brushstrokes' },
  { key: 'watercolor', label: 'Watercolor', modifier: 'watercolor painting, soft washes, fluid and organic' },
  { key: 'digital-art', label: 'Digital Art', modifier: 'digital art, clean lines, vibrant colors' },
  { key: 'abstract', label: 'Abstract', modifier: 'abstract art, non-representational, bold shapes and colors' },
  { key: 'minimalist', label: 'Minimalist', modifier: 'minimalist style, simple forms, negative space, clean composition' },
  { key: 'pop-art', label: 'Pop Art', modifier: 'pop art style, bold colors, graphic patterns, high contrast' },
  { key: 'sketch', label: 'Sketch', modifier: 'pencil sketch, detailed linework, hand-drawn feel' },
] as const

export type StyleKey = (typeof STYLE_PRESETS)[number]['key']

// ============================================
// Medium Presets
// ============================================

export const MEDIUM_PRESETS = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'paper', label: 'Paper' },
  { key: 'digital', label: 'Digital' },
  { key: 'mixed-media', label: 'Mixed Media' },
] as const

export type MediumKey = (typeof MEDIUM_PRESETS)[number]['key']

// ============================================
// Mood Presets
// ============================================

export const MOOD_PRESETS = [
  { key: 'serene', label: 'Serene' },
  { key: 'dramatic', label: 'Dramatic' },
  { key: 'vibrant', label: 'Vibrant' },
  { key: 'moody', label: 'Moody' },
  { key: 'ethereal', label: 'Ethereal' },
  { key: 'bold', label: 'Bold' },
] as const

export type MoodKey = (typeof MOOD_PRESETS)[number]['key']

// ============================================
// Aspect Ratios
// ============================================
//
// The list is print-aligned: each ratio matches one or more of the
// Gelato museum-poster product types we sell (see
// lib/gelato-templates.ts). Generating at any other ratio means
// Gelato has to crop or letterbox at print time — visible quality
// loss on the wall.
//
// Long-edge sticks at 1024 (Gemini's preferred output dim); the
// other edge falls out of the ratio. The image gets upscaled 4× via
// Real-ESRGAN before pushToGelato — see lib/upscale-runner.ts.
//
// The 1:1 option stays for non-print uses (square crops, social,
// future square poster sizes).

export const ASPECT_RATIOS = [
  { key: '7:10', label: '7:10 portrait — 21×30 or 70×100 cm', width: 720, height: 1024 },
  { key: '3:4',  label: '3:4 portrait — 30×40 cm',            width: 768, height: 1024 },
  { key: '2:3',  label: '2:3 portrait — 30×45 or 60×90 cm',   width: 683, height: 1024 },
  { key: '4:5',  label: '4:5 portrait — 40×50 cm',            width: 819, height: 1024 },
  { key: '5:7',  label: '5:7 portrait — 50×70 cm',            width: 731, height: 1024 },
  { key: '1:1',  label: 'Square (1:1) — non-print',           width: 1024, height: 1024 },
] as const

export type AspectRatioKey = (typeof ASPECT_RATIOS)[number]['key']

// ============================================
// TypeScript Types
// ============================================

export interface EditHistoryEntry {
  instruction: string
  timestamp: string
  model: string
  /** URL of the image as it was BEFORE this edit (for diff/restore UI) */
  previousImageUrl?: string
  /** Storage path of the previous image, kept so we can re-link if needed */
  previousStoragePath?: string
}

export interface GeneratedImage {
  id: string
  prompt: string
  edit_history: EditHistoryEntry[]
  model: string
  aspect_ratio: string
  style_preset: string | null
  image_url: string
  storage_path: string
  topic_id: string | null
  artwork_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

/**
 * Which generation engine to use:
 *   - 'gemini' (default) → Nano Banana 2 raster image
 *   - 'claude_vector'    → Claude writes SVG directly (Tier 5 native vector)
 *
 * Vector mode requires `stylePackId` and ignores `model` / `aspectRatio`.
 */
export type GeneratorEngine = 'gemini' | 'claude_vector'

export interface GenerateParams {
  prompt: string
  model: ModelKey
  aspectRatio: AspectRatioKey
  style?: StyleKey
  medium?: MediumKey
  mood?: MoodKey
  topicId?: string
  contributionContext?: string
  /**
   * Optional style pack id (kebab-case). When set, the generator uses
   * `buildStyledPrompt` from `lib/style-packs` instead of the structured
   * style/medium/mood preset chain. Style packs encapsulate the full AI
   * artist voice (master prompt + locked palette + composition rules)
   * and are the recommended path for the launch collection.
   */
  stylePackId?: string
  /** Engine to use for generation — see {@link GeneratorEngine}. */
  engine?: GeneratorEngine
}

export interface EditParams {
  imageId: string
  instruction: string
  model: ModelKey
  /**
   * Optional base64-encoded PNG mask. White pixels = regions Gemini
   * should edit. Black/transparent pixels = leave untouched. When
   * supplied, the edit route prepends a stronger mask-aware prompt.
   */
  maskBase64?: string
  /**
   * When true, the edit creates a NEW generated_images row instead of
   * mutating the source. Useful when the operator wants to branch
   * (keep the original AND the edited version side-by-side).
   */
  saveAsNew?: boolean
}

export interface GeneratedImageFilters {
  topic_id?: string
  artwork_id?: string
  limit?: number
  offset?: number
}

/**
 * Build a full prompt from structured parameters.
 */
export function buildFullPrompt(params: GenerateParams): string {
  const parts: string[] = []

  // Style modifier
  const style = STYLE_PRESETS.find(s => s.key === params.style)
  if (style) parts.push(style.modifier)

  // Medium
  const medium = MEDIUM_PRESETS.find(m => m.key === params.medium)
  if (medium) parts.push(`on ${medium.label.toLowerCase()}`)

  // Mood
  const mood = MOOD_PRESETS.find(m => m.key === params.mood)
  if (mood) parts.push(`${mood.label.toLowerCase()} mood`)

  // User prompt
  parts.push(params.prompt)

  // Contribution context
  if (params.contributionContext) {
    parts.push(`\n\nCreative context from community contributions:\n${params.contributionContext}`)
  }

  return parts.join('. ')
}
