'use server'

import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { callClaude } from '@/lib/agents/base'

/**
 * Schedule a social_post for publishing.
 *
 * Bridges the gap between Content Studio's client-side PNG export and
 * the posting worker (which expects public asset URLs in
 * `social_posts.visual_config.exported_image_urls`). Until a server-side
 * canvas-rendering pipeline lands, the operator's flow is:
 *
 *   1. Draft + "Export & Upload" PNGs in Content Studio
 *   2. Call this action with scheduled time + platform(s)
 *
 * `image_urls` / `video_url` may still be supplied explicitly, but if
 * omitted this action reuses assets already stamped onto visual_config.
 *
 * The action:
 *   - Stores the asset URLs on `social_posts.visual_config` so the
 *     posting worker can find them
 *   - Inserts one `posting_schedule` row per requested platform
 *   - Sets `social_posts.status = 'scheduled'`
 *
 * Idempotency: if a `posting_schedule` row already exists for the
 * (social_post_id, platform) pair in a non-terminal state, this
 * action updates that row instead of creating duplicates.
 */
export async function schedulePostForPublishingAction(
  socialPostId: string,
  formData: FormData
): Promise<{ scheduledIds: string[] }> {
  const scheduledForRaw = (formData.get('scheduled_for') as string | null)?.trim()
  const platformsRaw = formData.getAll('platforms')
  const imageUrlsRaw = (formData.get('image_urls') as string | null)?.trim()
  const videoUrl = (formData.get('video_url') as string | null)?.trim() || undefined

  if (!scheduledForRaw) {
    throw new Error('scheduled_for is required (ISO string).')
  }
  const scheduledFor = new Date(scheduledForRaw)
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new Error('scheduled_for must be a valid ISO date.')
  }

  const platforms = platformsRaw
    .map((p) => String(p))
    .filter((p): p is 'instagram' | 'facebook' => p === 'instagram' || p === 'facebook')

  if (platforms.length === 0) {
    throw new Error('Select at least one platform (instagram, facebook).')
  }

  const imageUrls = (imageUrlsRaw ?? '')
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter(Boolean)

  const { data: post, error: fetchError } = await supabaseAdmin
    .from('social_posts')
    .select('id, visual_config')
    .eq('id', socialPostId)
    .maybeSingle()

  if (fetchError) throw new Error(`fetch social_post failed: ${fetchError.message}`)
  if (!post) throw new Error(`social_post ${socialPostId} not found`)

  const existingConfig = ((post as { visual_config: Record<string, unknown> }).visual_config) ?? {}
  const existingImageUrls = Array.isArray(existingConfig.exported_image_urls)
    ? existingConfig.exported_image_urls.filter((url): url is string => typeof url === 'string' && url.length > 0)
    : []
  const existingVideoUrl =
    typeof existingConfig.exported_video_url === 'string' && existingConfig.exported_video_url.length > 0
      ? existingConfig.exported_video_url
      : undefined
  const finalImageUrls = imageUrls.length > 0 ? imageUrls : existingImageUrls
  const finalVideoUrl = videoUrl ?? existingVideoUrl

  if (finalImageUrls.length === 0 && !finalVideoUrl) {
    throw new Error('Export & Upload this post first, or provide at least one image URL or a video URL.')
  }

  const updatedVisualConfig = {
    ...existingConfig,
    exported_image_urls: finalImageUrls,
    exported_video_url: finalVideoUrl ?? null,
    exported_at: new Date().toISOString(),
  }

  const { error: updateError } = await supabaseAdmin
    .from('social_posts')
    .update({
      visual_config: updatedVisualConfig,
      status: 'scheduled',
      scheduled_for: scheduledFor.toISOString(),
    })
    .eq('id', socialPostId)

  if (updateError) throw new Error(`update social_post failed: ${updateError.message}`)

  const scheduledIds: string[] = []
  for (const platform of platforms) {
    // Upsert per (social_post_id, platform): if there is an existing
    // pending/scheduled row for this pair, update it. Otherwise insert.
    const { data: existing } = await supabaseAdmin
      .from('posting_schedule')
      .select('id, status')
      .eq('social_post_id', socialPostId)
      .eq('platform', platform)
      .in('status', ['pending', 'scheduled', 'failed'])
      .order('created_at', { ascending: false })
      .limit(1)

    const existingRow = (existing ?? [])[0] as { id: string } | undefined

    if (existingRow) {
      await supabaseAdmin
        .from('posting_schedule')
        .update({
          scheduled_for: scheduledFor.toISOString(),
          status: 'scheduled',
          error_message: null,
        })
        .eq('id', existingRow.id)
      scheduledIds.push(existingRow.id)
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('posting_schedule')
        .insert({
          social_post_id: socialPostId,
          platform,
          scheduled_for: scheduledFor.toISOString(),
          status: 'scheduled',
        })
        .select('id')
        .single()

      if (insertError) {
        throw new Error(`insert posting_schedule failed: ${insertError.message}`)
      }
      scheduledIds.push((inserted as { id: string }).id)
    }
  }

  revalidatePath('/content')
  revalidatePath(`/content/${socialPostId}`)
  return { scheduledIds }
}

/**
 * Redraft the caption for a social post in the brand voice.
 *
 * Returns the new caption WITHOUT writing it: the editor puts it into
 * state and the normal save/autosave flow persists it, so the operator
 * can edit or discard before anything sticks.
 *
 * Voice rules are hard requirements (operator, 2026-07): premium and
 * gallery-like, no hype or clichés, no em dashes, and NEVER any mention
 * of AI or machine provenance in customer-facing copy.
 */
export async function regenerateCaptionAction(
  socialPostId: string
): Promise<{ ok: boolean; caption?: string; message: string }> {
  const { data: post, error } = await supabaseAdmin
    .from('social_posts')
    .select(
      'id, post_type, caption, tags, artworks(title, price, currency, product_type, shopify_handle, description, users(name))'
    )
    .eq('id', socialPostId)
    .maybeSingle()

  if (error) return { ok: false, message: `fetch failed: ${error.message}` }
  if (!post) return { ok: false, message: 'Post not found' }

  const art = (post as Record<string, unknown>).artworks as {
    title: string
    price: number | null
    currency: string | null
    product_type: string | null
    shopify_handle: string | null
    description: string | null
    users: { name: string | null } | null
  } | null

  if (!art) {
    return { ok: false, message: 'Post has no linked artwork; write the caption by hand.' }
  }

  const sizeMatch = art.product_type?.match(/(\d+)x(\d+)/)
  const size = sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]} cm` : null
  const kindTag = ((post as { tags?: string[] }).tags ?? []).find((t) => t.startsWith('kind:'))
  const kind = kindTag?.replace('kind:', '') ?? (post as { post_type: string }).post_type

  const system = `You write Instagram captions for Artinscale, a premium art-print gallery. The voice is refined and gallery-like: calm, concrete, unhurried. Hard rules:
- NEVER mention AI, machine generation, algorithms, or automation in any form. Speak of the piece and the studio only.
- NEVER mention the price or any cost. Price lives on the product page, not in posts.
- Never use em dashes. Use a comma, a colon, or two sentences instead.
- No hype, no clichés ("elevate your space", "stunning", "must-have"), no emoji, no exclamation marks.
- No hashtags.
- 40 to 80 words, then a blank line, then the product link on its own line.
Return ONLY the caption text, nothing else.`

  const user = `Artwork: "${art.title}"${art.users?.name ? ` by ${art.users.name}` : ''}
${art.description ? `About the piece: ${art.description}` : ''}
Product: museum-quality matte print${size ? `, ${size}` : ''}, made to order.
Post format: ${kind}.
Product link: artinscale.com/product/${art.shopify_handle ?? ''}

Current caption (write a fresh alternative, do not copy its phrasing):
${(post as { caption: string | null }).caption ?? '(none)'}`

  try {
    const raw = await callClaude({ system, user, maxTokens: 400 })
    // Belt-and-braces on the two hard rules: strip em dashes and reject
    // any AI-provenance wording the model might sneak in.
    let text = raw.trim().replace(/\s*—\s*/g, ', ')
    const lines = text
      .split('\n')
      .filter((l) => !/\b(AI|artificial intelligence|machine[- ]generated|algorithm)/i.test(l))
    text = lines.join('\n').trim()
    if (!text) return { ok: false, message: 'Draft came back empty; try again.' }
    return { ok: true, caption: text, message: 'Caption redrafted.' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `Claude call failed: ${message}` }
  }
}
