'use client'

import { Card, CardContent } from '@/components/ui/card'
import type { ContentStats } from '@/lib/constants/content'

export function ContentStatsHeader({ stats }: { stats: ContentStats }) {
  return (
    <Card padding="none">
      <CardContent>
        <div className="grid grid-cols-4 divide-x divide-gray-200">
          <div className="px-4 py-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total Posts</p>
            <p className="text-xl font-bold mt-0.5">{stats.total}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Drafts</p>
            <p className="text-xl font-bold mt-0.5 text-amber-600">{stats.drafts}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Scheduled</p>
            <p className="text-xl font-bold mt-0.5 text-blue-500">{stats.scheduled}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Published</p>
            <p className="text-xl font-bold mt-0.5 text-emerald-600">{stats.published}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
