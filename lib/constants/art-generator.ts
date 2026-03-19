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
    modelId: 'gemini-2.0-flash-exp',
    description: 'Fast generation, good for iteration',
  },
  {
    key: 'pro',
    label: 'Nano Banana Pro (Quality)',
    modelId: 'gemini-2.0-flash-exp',
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

export const ASPECT_RATIOS = [
  { key: '1:1', label: 'Square (1:1)', width: 1024, height: 1024 },
  { key: '3:4', label: 'Portrait (3:4)', width: 768, height: 1024 },
  { key: '4:3', label: 'Landscape (4:3)', width: 1024, height: 768 },
  { key: '9:16', label: 'Tall (9:16)', width: 576, height: 1024 },
  { key: '16:9', label: 'Wide (16:9)', width: 1024, height: 576 },
] as const

export type AspectRatioKey = (typeof ASPECT_RATIOS)[number]['key']

// ============================================
// TypeScript Types
// ============================================

export interface EditHistoryEntry {
  instruction: string
  timestamp: string
  model: string
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

export interface GenerateParams {
  prompt: string
  model: ModelKey
  aspectRatio: AspectRatioKey
  style?: StyleKey
  medium?: MediumKey
  mood?: MoodKey
  topicId?: string
  contributionContext?: string
}

export interface EditParams {
  imageId: string
  instruction: string
  model: ModelKey
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
