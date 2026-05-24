/**
 * Posting worker.
 *
 * Picks due rows from `posting_schedule` and publishes them via the
 * Meta Graph publisher. Idempotent at the row level (status guards).
 *
 * Triggered either by Inngest cron OR via /api/agents/run/posting-worker
 * for manual/test execution.
 */

import { publishSocialPost } from './meta-graph'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface WorkerResult {
  picked: number
  published: number
  failed: number
  errors: Array<{ id: string; message: string }>
}

const MAX_BATCH = 5

export async function runPostingWorker(): Promise<WorkerResult> {
  const now = new Date().toISOString()

  const { data: due, error: dueError } = await supabaseAdmin
    .from('posting_schedule')
    .select(
      'id, social_post_id, platform, scheduled_for, status, attempts, social_posts(visual_config, caption, post_type)'
    )
    .lte('scheduled_for', now)
    .in('status', ['pending', 'scheduled'])
    .order('scheduled_for', { ascending: true })
    .limit(MAX_BATCH)

  // Surface table-missing or RLS errors loudly rather than silently
  // returning "0 picked" — the migration audit caught one case where
  // posting_schedule didn't exist and the worker pretended everything
  // was fine.
  if (dueError) {
    throw new Error(`posting_schedule query failed: ${dueError.message}`)
  }

  type Row = {
    id: string
    social_post_id: string
    platform: 'instagram' | 'facebook'
    attempts: number
    social_posts: {
      visual_config: { exported_image_urls?: string[]; exported_video_url?: string } | null
      caption: string | null
      post_type: 'single' | 'carousel' | 'reel'
    } | null
  }

  const items = (due ?? []) as unknown as Row[]
  const result: WorkerResult = { picked: items.length, published: 0, failed: 0, errors: [] }

  for (const row of items) {
    try {
      // Mark as publishing first to avoid concurrent workers picking it up
      const { error: claimError } = await supabaseAdmin
        .from('posting_schedule')
        .update({
          status: 'publishing',
          attempts: row.attempts + 1,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .in('status', ['pending', 'scheduled']) // optimistic concurrency
      if (claimError) {
        result.errors.push({ id: row.id, message: `claim failed: ${claimError.message}` })
        continue
      }

      const post = row.social_posts
      if (!post) throw new Error(`social_post row missing for posting_schedule ${row.id}`)
      if (!post.caption) throw new Error('social_post has no caption')

      const imageUrls = post.visual_config?.exported_image_urls ?? []
      const videoUrl = post.visual_config?.exported_video_url

      const published = await publishSocialPost({
        platform: row.platform,
        postType: post.post_type,
        imageUrls,
        videoUrl,
        caption: post.caption,
      })

      await supabaseAdmin
        .from('posting_schedule')
        .update({
          status: 'published',
          external_post_id: published.externalId,
          external_permalink: published.permalink ?? null,
          published_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', row.id)

      // Mirror the status onto the underlying social_posts row
      await supabaseAdmin
        .from('social_posts')
        .update({ status: 'published' })
        .eq('id', row.social_post_id)

      result.published += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await supabaseAdmin
        .from('posting_schedule')
        .update({ status: 'failed', error_message: message })
        .eq('id', row.id)
      result.failed += 1
      result.errors.push({ id: row.id, message })
    }
  }

  return result
}
