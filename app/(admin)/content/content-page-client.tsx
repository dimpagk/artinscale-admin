'use client'

import { useState } from 'react'
import { InstagramLogo, XLogo } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Tabs } from '@/components/ui/tabs'
import { PLATFORMS } from '@/lib/constants/content'
import { ContentPostsGrid } from '@/components/content/content-posts-grid'
import { ContentCalendar } from '@/components/content/content-calendar'
import { TemplatePicker } from '@/components/content/template-picker'
import { MarketingClient } from '../marketing/marketing-client'
import type { SocialPost } from '@/lib/constants/content'
import type { AdCreativeGroup } from '@/lib/ad-creatives'

interface ContentPageClientProps {
  posts: SocialPost[]
  scheduledPosts: SocialPost[]
  adGroups: AdCreativeGroup[]
  adCampaign: string
  initialTab?: string
}

const TAB_IDS = ['posts', 'calendar', 'ad-copy'] as const

export function ContentPageClient({
  posts,
  scheduledPosts,
  adGroups,
  adCampaign,
  initialTab,
}: ContentPageClientProps) {
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [platform, setPlatform] = useState('all')
  const [activeTab, setActiveTab] = useState<string>(
    (TAB_IDS as readonly string[]).includes(initialTab ?? '') ? initialTab! : 'posts'
  )

  const tabs = [
    { id: 'posts', label: 'Posts' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'ad-copy', label: 'Ad copy', count: adGroups.length },
  ]

  return (
    <>
      <div className="flex items-center justify-between">
        <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Platform filter — only relevant to the social tabs. */}
        {activeTab !== 'ad-copy' && (
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
        )}
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

        {activeTab === 'ad-copy' && (
          <div className="space-y-4">
            <p className="max-w-2xl text-sm text-gray-500">
              Paid-ad copy for the Meta test ({adCampaign}), one card per piece.
              Review, edit, and approve here, then paste the approved copy into
              Meta Ads Manager. Nothing on this page publishes on its own. Per-market
              bid caps live under Economics → Bid caps.
            </p>
            <MarketingClient groups={adGroups} />
          </div>
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
