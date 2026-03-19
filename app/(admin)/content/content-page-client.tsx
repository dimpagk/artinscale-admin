'use client'

import { useState } from 'react'
import { InstagramLogo, XLogo } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Tabs } from '@/components/ui/tabs'
import { PLATFORMS } from '@/lib/constants/content'
import { ContentPostsGrid } from '@/components/content/content-posts-grid'
import { ContentCalendar } from '@/components/content/content-calendar'
import { TemplatePicker } from '@/components/content/template-picker'
import type { SocialPost } from '@/lib/constants/content'

interface ContentPageClientProps {
  posts: SocialPost[]
  scheduledPosts: SocialPost[]
}

const CONTENT_TABS = [
  { id: 'posts', label: 'Posts' },
  { id: 'calendar', label: 'Calendar' },
]

export function ContentPageClient({ posts, scheduledPosts }: ContentPageClientProps) {
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [platform, setPlatform] = useState('all')
  const [activeTab, setActiveTab] = useState('posts')

  return (
    <>
      <div className="flex items-center justify-between">
        <Tabs tabs={CONTENT_TABS} activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Platform filter */}
        <div className="flex items-center gap-1">
          {PLATFORMS.map(p => (
            <Button
              key={p.key}
              variant={platform === p.key ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setPlatform(p.key)}
              icon={
                p.key === 'instagram' ? <InstagramLogo size={14} weight="bold" /> :
                p.key === 'twitter' ? <XLogo size={14} weight="bold" /> :
                undefined
              }
              className="h-8"
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {activeTab === 'posts' && (
          <ContentPostsGrid
            initialPosts={posts}
            onNewPost={() => setTemplatePickerOpen(true)}
            platform={platform}
          />
        )}

        {activeTab === 'calendar' && (
          <ContentCalendar posts={scheduledPosts} />
        )}
      </div>

      {/* Template picker */}
      <TemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
      />
    </>
  )
}
