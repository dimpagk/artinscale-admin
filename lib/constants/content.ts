/**
 * Content Studio Constants
 *
 * Brand tokens, visual presets, block types, and status configuration
 * for the social media content creation feature.
 *
 * Adapted from Dilipod content studio with ArtInScale brand tokens
 * and artwork-specific block types.
 */

// ============================================
// Brand Tokens (used by preview + canvas export)
// ============================================

export const BRAND_TOKENS = {
  // Primary logo colors
  navy: '#0C103D',
  coral: '#F72D5E',
  gold: '#F6B61C',
  blue: '#1617F7',
  cyan: '#00C3DD',
  // Neutrals
  black: '#000000',
  white: '#FFFFFF',
  grey: '#666666',
  lightGrey: '#F5F5F5',
  // Light tints
  cyanLight: '#E6F9FC',
  coralLight: '#FDF2F5',
  goldLight: '#FEF7E6',
  blueLight: '#E6E7FE',
  purpleLight: '#F3F0F8',
  // Typography
  displayFont: "Outfit,'Outfit Fallback',system-ui,sans-serif",
  bodyFont: "DM Sans,'DM Sans Fallback',system-ui,sans-serif",
  // Default dimensions (Instagram portrait)
  postWidth: 1080,
  postHeight: 1350,
} as const

// ============================================
// Post Formats
// ============================================

export const POST_FORMATS = {
  square:          { key: 'square',          label: 'Square',          width: 1080, height: 1080, ratio: '1/1',      category: 'feed'  },
  portrait:        { key: 'portrait',        label: 'Portrait',        width: 1080, height: 1350, ratio: '4/5',      category: 'feed'  },
  landscape:       { key: 'landscape',       label: 'Landscape',       width: 1200, height: 628,  ratio: '1200/628', category: 'feed'  },
  story:           { key: 'story',           label: 'Story / Reel',    width: 1080, height: 1920, ratio: '9/16',     category: 'story' },
  x_cover:         { key: 'x_cover',         label: 'X Cover',         width: 1500, height: 500,  ratio: '3/1',      category: 'cover' },
  linkedin_banner: { key: 'linkedin_banner', label: 'LinkedIn Banner', width: 1584, height: 396,  ratio: '4/1',      category: 'cover' },
} as const

export type PostFormatKey = keyof typeof POST_FORMATS

/** Resolve format config, defaulting to portrait for backward compat */
export function getPostFormat(key?: string): (typeof POST_FORMATS)[PostFormatKey] {
  if (key && key in POST_FORMATS) return POST_FORMATS[key as PostFormatKey]
  return POST_FORMATS.portrait
}

// ============================================
// Background Presets
// ============================================

export const BACKGROUND_PRESETS = [
  {
    key: 'galleryWhite',
    label: 'Gallery White',
    css: "radial-gradient(ellipse at 30% 20%, #F5F5F5 0%, #FFFFFF 70%)",
    dark: false,
  },
  {
    key: 'deepBlack',
    label: 'Deep Black',
    css: "radial-gradient(ellipse at 70% 30%, #1a1a2e 0%, #000000 60%)",
    dark: true,
  },
  {
    key: 'warmCream',
    label: 'Warm Cream',
    css: "linear-gradient(135deg, #FEF7E6, #FDF2F5)",
    dark: false,
  },
  {
    key: 'dramaticDark',
    label: 'Dramatic Dark',
    css: "radial-gradient(ellipse at 20% 80%, rgba(247,45,94,0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(246,182,28,0.12) 0%, transparent 50%), #000000",
    dark: true,
  },
  {
    key: 'coralGlow',
    label: 'Coral Glow',
    css: "radial-gradient(ellipse at 90% 10%, rgba(247,45,94,0.25) 0%, transparent 45%), #000000",
    dark: true,
  },
] as const

export type BackgroundPresetKey = (typeof BACKGROUND_PRESETS)[number]['key']

// ============================================
// Accent Presets
// ============================================

export const ACCENT_PRESETS = [
  { key: 'topBar', label: 'Top Bar' },
  { key: 'glowBlob', label: 'Glow Blob' },
  { key: 'diagonal', label: 'Diagonal' },
  { key: 'splitGlow', label: 'Split Glow' },
  { key: 'none', label: 'None' },
] as const

export type AccentPresetKey = (typeof ACCENT_PRESETS)[number]['key']

// ============================================
// Block Types
// ============================================

export const BLOCK_TYPES = [
  { type: 'tag', label: 'Tag / Label', defaultValue: { type: 'tag', text: 'LABEL' } },
  { type: 'headline', label: 'Headline', defaultValue: { type: 'headline', text: 'Headline Text', fontSize: 'lg' } },
  { type: 'text', label: 'Body Text', defaultValue: { type: 'text', text: 'Body text here' } },
  { type: 'steps', label: 'Steps', defaultValue: { type: 'steps', items: ['Step 1', 'Step 2', 'Step 3'] } },
  { type: 'bullets', label: 'Bullet List', defaultValue: { type: 'bullets', items: ['Item 1', 'Item 2'] } },
  { type: 'spacer', label: 'Spacer', defaultValue: { type: 'spacer', height: 20 } },
  { type: 'divider', label: 'Divider', defaultValue: { type: 'divider' } },
  { type: 'metric', label: 'Metric', defaultValue: { type: 'metric', value: '150+', label: 'Artworks Created' } },
  { type: 'quote', label: 'Quote', defaultValue: { type: 'quote', text: 'Quote text', author: '' } },
  { type: 'table', label: 'Table', defaultValue: { type: 'table', headers: ['Artwork', 'Artist', 'Edition'], rows: [['Echoes', 'Maya Lin', '1/50'], ['Fragments', 'Kai Rowe', '3/25']], caption: '' } },
  { type: 'progress', label: 'Progress Bar', defaultValue: { type: 'progress', label: 'Editions Sold', value: 38, target: 50, unit: '' } },
  { type: 'screenshot', label: 'Image', defaultValue: { type: 'screenshot', url: '', alt: 'Artwork image', border: true } },
  // Artwork-specific blocks
  { type: 'artworkShowcase', label: 'Artwork Showcase', defaultValue: { type: 'artworkShowcase', artworkTitle: 'Artwork Title', artistName: 'Artist Name', imageUrl: '', topicTitle: '' } },
  { type: 'artistCredit', label: 'Artist Credit', defaultValue: { type: 'artistCredit', artistName: 'Artist Name', bio: '', imageUrl: '' } },
  { type: 'editionInfo', label: 'Edition Info', defaultValue: { type: 'editionInfo', editionSize: 50, editionSold: 0, status: 'available' } },
  { type: 'priceDisplay', label: 'Price & CTA', defaultValue: { type: 'priceDisplay', price: '', cta: 'Shop at artinscale.com', shopifyHandle: '' } },
] as const

// ============================================
// Post Status Configuration
// ============================================

export const SOCIAL_POST_STATUSES = {
  draft: { label: 'Draft', color: 'bg-amber-100 text-amber-700' },
  scheduled: { label: 'Scheduled', color: 'bg-blue-100 text-blue-700' },
  published: { label: 'Published', color: 'bg-emerald-100 text-emerald-700' },
} as const

export type SocialPostStatus = keyof typeof SOCIAL_POST_STATUSES

// ============================================
// Platform Configuration
// ============================================

export const PLATFORMS = [
  { key: 'all', label: 'All' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'twitter', label: 'X / Twitter' },
] as const

export type Platform = 'instagram' | 'twitter' | 'linkedin' | 'facebook'

// ============================================
// TypeScript Types
// ============================================

export type BlockType =
  | { type: 'tag'; text: string }
  | { type: 'headline'; text: string; fontSize?: 'sm' | 'md' | 'lg' }
  | { type: 'text'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'bullets'; items: string[] }
  | { type: 'spacer'; height?: number }
  | { type: 'divider' }
  | { type: 'metric'; value: string; label: string }
  | { type: 'quote'; text: string; author?: string }
  | { type: 'table'; headers: string[]; rows: string[][]; caption?: string }
  | { type: 'progress'; label: string; value: number; target: number; unit?: string }
  | { type: 'dashboardCard'; title: string; metrics: { value: string; label: string }[] }
  | { type: 'screenshot'; url: string; alt?: string; border?: boolean }
  // Artwork-specific blocks
  | { type: 'artworkShowcase'; artworkTitle: string; artistName: string; imageUrl: string; topicTitle?: string }
  | { type: 'artistCredit'; artistName: string; bio: string; imageUrl: string }
  | { type: 'editionInfo'; editionSize: number; editionSold: number; status: string }
  | { type: 'priceDisplay'; price: string; cta: string; shopifyHandle: string }

/** Visual config for a single slide / single post */
export interface SlideConfig {
  bg: string
  dark: boolean
  accent: string
  footer: string
  blocks: BlockType[]
  format?: PostFormatKey
}

/** VisualConfig — backward compatible. Single posts use top-level fields, carousels use `slides`. */
export interface VisualConfig extends SlideConfig {
  slides?: SlideConfig[]
}

/** Helper: get all slides from a config (works for both single and carousel) */
export function getSlides(config: VisualConfig): SlideConfig[] {
  if (config.slides && config.slides.length > 0) return config.slides
  // Single post: wrap top-level config as one slide
  const { slides: _, ...single } = config
  return [single]
}

/** Helper: create a default empty slide */
export function createDefaultSlide(base?: Partial<SlideConfig>): SlideConfig {
  return {
    bg: 'deepBlack',
    dark: true,
    accent: 'topBar',
    footer: 'artinscale.com',
    blocks: [
      { type: 'tag', text: 'LABEL' },
      { type: 'headline', text: 'Slide Title', fontSize: 'lg' },
    ],
    format: 'portrait',
    ...base,
  }
}

export interface SocialPost {
  id: string
  platform: string
  post_type: string
  title: string | null
  visual_config: VisualConfig
  caption: string | null
  status: SocialPostStatus
  scheduled_for: string | null
  tags: string[]
  artwork_id: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface ContentStats {
  total: number
  drafts: number
  scheduled: number
  published: number
}

/**
 * Resolve a background preset key to its CSS value.
 * If key doesn't match a preset, returns it as raw CSS (custom bg support).
 */
export function resolveBackground(bg: string): { css: string; dark: boolean } {
  const preset = BACKGROUND_PRESETS.find(p => p.key === bg)
  if (preset) return { css: preset.css, dark: preset.dark }
  return { css: bg, dark: false }
}
