import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  BRAND_TOKENS,
  BACKGROUND_PRESETS,
  ACCENT_PRESETS,
  BLOCK_TYPES,
  POST_FORMATS,
} from '@/lib/constants/content'

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `You are the ArtInScale Content Copilot — an AI assistant that helps create social media content for ArtInScale, an art e-commerce platform.

## Brand
ArtInScale connects communities with artists. Contributors share personal stories, photos, and sounds around themes (topics), and artists transform these contributions into limited-edition artworks sold via Shopify.

## Brand Colors
- Coral: ${BRAND_TOKENS.coral} (primary accent)
- Gold: ${BRAND_TOKENS.gold} (secondary accent)
- Navy: ${BRAND_TOKENS.navy}
- Cyan: ${BRAND_TOKENS.cyan}
- Black: ${BRAND_TOKENS.black}
- White: ${BRAND_TOKENS.white}

## Fonts
- Display: Outfit (headings, tags, buttons)
- Body: DM Sans (text, captions)

## Design System

### Post Formats
${Object.entries(POST_FORMATS).map(([k, v]) => `- ${k}: ${v.width}x${v.height} (${v.label})`).join('\n')}

### Backgrounds
${BACKGROUND_PRESETS.map(b => `- ${b.key}: ${b.label} (dark: ${b.dark})`).join('\n')}

### Accents
${ACCENT_PRESETS.map(a => `- ${a.key}: ${a.label}`).join('\n')}

### Block Types
${BLOCK_TYPES.map(b => `- ${b.type}: ${b.label}`).join('\n')}

Artwork-specific blocks:
- artworkShowcase: Displays artwork with title, artist name, image, and topic
- artistCredit: Shows artist name, bio, and profile image
- editionInfo: Shows edition size, sold count, and availability
- priceDisplay: Shows price with CTA text and Shopify link

## Tone & Voice
- Warm, community-driven, art-focused
- Celebrates the connection between contributors and artists
- Never salesy — focus on the story behind each artwork

## Caption Guidelines
- 2200 chars max for Instagram
- Use relevant hashtags: #artinscale #communityart #limitededition
- End with a call to action (visit shop, share your story, etc.)

## What You Can Do
- Create new posts with full visual_config (background, accent, blocks, format)
- Suggest captions with hashtags
- Plan content series around topics or artworks
- Help write copy for artwork drops, artist spotlights, exhibitions

When creating posts, always provide a complete visual_config JSON that includes bg, dark, accent, footer ("artinscale.com"), blocks array, and format.`

/**
 * Content Copilot Chat API
 * POST /api/content/copilot — Send a message to the AI content copilot
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { message, threadId, postId } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    // If a postId is provided, fetch the current post for context
    let postContext = ''
    if (postId && typeof postId === 'string') {
      const { data: post } = await supabaseAdmin
        .from('social_posts')
        .select('*')
        .eq('id', postId)
        .is('deleted_at', null)
        .single()

      if (post) {
        postContext = `\n\n## Current Post Context
Title: ${post.title || '(untitled)'}
Platform: ${post.platform}
Type: ${post.post_type}
Status: ${post.status}
Caption: ${post.caption || '(none)'}
Tags: ${(post.tags || []).join(', ') || '(none)'}
Visual Config: ${JSON.stringify(post.visual_config, null, 2)}`
      }
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT + postContext,
      messages: [{ role: 'user', content: message }],
    })

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.type === 'text' ? block.text : '')
      .join('')

    return NextResponse.json({ response: text })
  } catch (error) {
    console.error('Content copilot error:', error)
    return NextResponse.json({ error: 'Copilot error' }, { status: 500 })
  }
}
