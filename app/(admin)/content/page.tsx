import { ContentStatsHeader } from '@/components/content/content-stats'
import { ContentPageClient } from './content-page-client'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { ContentStats, SocialPost } from '@/lib/constants/content'

async function getContentStats(): Promise<ContentStats> {
  const { data, error } = await supabaseAdmin
    .from('social_posts')
    .select('status')
    .is('deleted_at', null)

  if (error || !data) return { total: 0, drafts: 0, scheduled: 0, published: 0 }

  return {
    total: data.length,
    drafts: data.filter(d => d.status === 'draft').length,
    scheduled: data.filter(d => d.status === 'scheduled').length,
    published: data.filter(d => d.status === 'published').length,
  }
}

async function getContentPosts(): Promise<SocialPost[]> {
  const { data, error } = await supabaseAdmin
    .from('social_posts')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) return []
  return (data || []) as SocialPost[]
}

async function getScheduledPosts(): Promise<SocialPost[]> {
  const { data, error } = await supabaseAdmin
    .from('social_posts')
    .select('*')
    .is('deleted_at', null)
    .not('scheduled_for', 'is', null)
    .order('scheduled_for', { ascending: true })

  if (error) return []
  return (data || []) as SocialPost[]
}

export default async function ContentPage() {
  const [stats, posts, scheduledPosts] = await Promise.all([
    getContentStats(),
    getContentPosts(),
    getScheduledPosts(),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Content</h1>
          <p className="text-gray-500 text-sm">Create and schedule social media posts</p>
        </div>
      </div>

      <ContentStatsHeader stats={stats} />
      <ContentPageClient posts={posts} scheduledPosts={scheduledPosts} />
    </div>
  )
}
