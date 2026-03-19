'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DotsThreeVertical, PencilSimple, Copy, DownloadSimple, Trash, Plus, Stack, PaintBrush } from '@phosphor-icons/react'
import { InstagramLogo, XLogo } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SOCIAL_POST_STATUSES, POST_FORMATS, getSlides, type SocialPost, type SocialPostStatus, type PostFormatKey } from '@/lib/constants/content'
import { PostCardPreview } from './post-card-preview'
import { downloadPostAsPng, downloadCarouselAsPngs } from './post-canvas-export'

interface ContentPostsGridProps {
  initialPosts: SocialPost[]
  onNewPost: () => void
  platform: string
}

const PlatformIcon = ({ platform, size = 12 }: { platform: string; size?: number }) => {
  if (platform === 'twitter') return <XLogo size={size} weight="bold" />
  return <InstagramLogo size={size} weight="bold" />
}

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning'> = {
  draft: 'default',
  scheduled: 'warning',
  published: 'success',
}

const FILTERS: { key: SocialPostStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
]

export function ContentPostsGrid({ initialPosts, onNewPost, platform }: ContentPostsGridProps) {
  const router = useRouter()
  const [posts, setPosts] = useState(initialPosts)
  const [filter, setFilter] = useState<SocialPostStatus | 'all'>('all')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const platformFiltered = platform === 'all' ? posts : posts.filter(p => p.platform === platform)
  const filtered = filter === 'all' ? platformFiltered : platformFiltered.filter(p => p.status === filter)

  const handleDuplicate = async (id: string) => {
    setMenuOpen(null)
    const res = await fetch(`/api/content/${id}/duplicate`, { method: 'POST' })
    if (res.ok) {
      const { post } = await res.json()
      setPosts(prev => [post, ...prev])
    }
  }

  const handleDelete = async (id: string) => {
    setMenuOpen(null)
    const res = await fetch(`/api/content/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setPosts(prev => prev.filter(p => p.id !== id))
    }
  }

  const handleDownload = async (post: SocialPost) => {
    setMenuOpen(null)
    const slug = post.title?.replace(/[^a-z0-9]/gi, '-').toLowerCase() || post.id
    if (post.post_type === 'carousel' && getSlides(post.visual_config).length > 1) {
      await downloadCarouselAsPngs(post.visual_config, `artinscale-${slug}`)
    } else {
      await downloadPostAsPng(post.visual_config, `artinscale-${slug}.png`)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-1">
        {FILTERS.map(f => (
          <Button
            key={f.key}
            variant={filter === f.key ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(f.key)}
            className={filter === f.key ? 'bg-[#0C103D]/10 text-[#0C103D] border-transparent' : ''}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {/* New Post card */}
        <button
          onClick={onNewPost}
          className="aspect-square border border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-[#F72D5E] hover:border-[#F72D5E]/40 transition-all"
        >
          <Plus size={24} />
          <span className="text-xs font-medium">New Post</span>
        </button>

        {filtered.map(post => (
          <div
            key={post.id}
            className="relative group cursor-pointer rounded-xl overflow-hidden border border-gray-200 hover:border-[#F72D5E]/40 hover:shadow-lg transition-all"
            onClick={() => router.push(`/content/${post.id}`)}
          >
            {/* Thumbnail */}
            <div className="aspect-square overflow-hidden relative">
              <PostCardPreview config={post.visual_config} size={300} />
              {post.post_type === 'carousel' && getSlides(post.visual_config).length > 1 && (
                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1">
                  <Stack size={10} weight="bold" />
                  {getSlides(post.visual_config).length}
                </div>
              )}
              {/* Artwork indicator */}
              {post.artwork_id && (
                <div className="absolute top-2 right-8 bg-[#F6B61C]/90 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1">
                  <PaintBrush size={10} weight="bold" />
                  Art
                </div>
              )}
            </div>

            {/* Info bar */}
            <div className="px-2.5 py-2 bg-white border-t border-gray-200">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-gray-400 shrink-0"><PlatformIcon platform={post.platform} /></span>
                {post.visual_config?.format && post.visual_config.format !== 'portrait' && (
                  <span className="text-[9px] text-gray-400 font-medium shrink-0">
                    {POST_FORMATS[post.visual_config.format as PostFormatKey]?.label}
                  </span>
                )}
                <p className="text-xs font-medium truncate flex-1">{post.title || 'Untitled'}</p>
                <Badge variant={STATUS_BADGE_VARIANT[post.status] || 'default'} size="sm">
                  {SOCIAL_POST_STATUSES[post.status]?.label || post.status}
                </Badge>
              </div>
              {post.scheduled_for && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {new Date(post.scheduled_for).toLocaleDateString()}
                </p>
              )}
            </div>

            {/* Menu trigger */}
            <button
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
              onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === post.id ? null : post.id) }}
            >
              <DotsThreeVertical size={14} />
            </button>

            {/* Dropdown menu */}
            {menuOpen === post.id && (
              <div className="absolute top-9 right-2 bg-white/95 backdrop-blur-md border border-gray-200 rounded-xl shadow-xl z-20 py-1.5 min-w-[130px]" onClick={e => e.stopPropagation()}>
                <button className="w-full text-left text-xs px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2 transition-colors" onClick={() => { setMenuOpen(null); router.push(`/content/${post.id}`) }}>
                  <PencilSimple size={12} /> Edit
                </button>
                <button className="w-full text-left text-xs px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2 transition-colors" onClick={() => handleDuplicate(post.id)}>
                  <Copy size={12} /> Duplicate
                </button>
                <button className="w-full text-left text-xs px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2 transition-colors" onClick={() => handleDownload(post)}>
                  <DownloadSimple size={12} /> Download PNG
                </button>
                <button className="w-full text-left text-xs px-3 py-1.5 hover:bg-gray-50 text-red-400 flex items-center gap-2 transition-colors" onClick={() => handleDelete(post.id)}>
                  <Trash size={12} /> Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && filter !== 'all' && (
        <p className="text-center text-gray-400 text-sm py-8">
          No {filter} posts yet.
        </p>
      )}
    </div>
  )
}
