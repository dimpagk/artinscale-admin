'use server'

import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase/admin'

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
