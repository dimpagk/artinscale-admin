'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { CaretLeft, CaretRight, InstagramLogo, XLogo, Clock, CheckCircle, CalendarBlank } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SOCIAL_POST_STATUSES, type SocialPost, type SocialPostStatus } from '@/lib/constants/content'
import { PostCardPreview } from '@/components/content/post-card-preview'

interface ContentCalendarProps {
  posts: SocialPost[]
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATUS_COLOR: Record<string, string> = {
  published: '#059669',
  scheduled: '#3b82f6',
  draft: '#f59e0b',
}

const STATUS_BG: Record<string, string> = {
  published: 'bg-emerald-500/10 border-emerald-500/20',
  scheduled: 'bg-blue-500/10 border-blue-500/20',
  draft: 'bg-amber-500/10 border-amber-500/20',
}

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning'> = {
  draft: 'default',
  scheduled: 'warning',
  published: 'success',
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function PlatformIcon({ platform, size = 10 }: { platform: string; size?: number }) {
  if (platform === 'instagram') return <InstagramLogo size={size} weight="bold" />
  if (platform === 'twitter') return <XLogo size={size} weight="bold" />
  return null
}

/** Compact teaser chip shown inside a day cell */
function PostTeaser({ post, onClick }: { post: SocialPost; onClick: () => void }) {
  const headline = post.visual_config?.blocks?.find((b: { type: string }) => b.type === 'headline') as { type: 'headline'; text: string } | undefined
  const displayTitle = post.title || headline?.text || 'Untitled'

  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      className={`w-full text-left rounded border px-1.5 py-0.5 transition-all hover:brightness-110 hover:shadow-sm ${STATUS_BG[post.status] || 'bg-gray-50 border-gray-200'}`}
    >
      <div className="flex items-center gap-1">
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[post.status] }} />
        <span className="text-[10px] font-medium truncate flex-1 leading-tight">{displayTitle}</span>
      </div>
    </button>
  )
}

export function ContentCalendar({ posts }: ContentCalendarProps) {
  const router = useRouter()
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    let startOffset = firstDay.getDay() - 1
    if (startOffset < 0) startOffset = 6

    const days: { date: Date; inMonth: boolean }[] = []

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i)
      days.push({ date: d, inMonth: false })
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), inMonth: true })
    }

    // Only add enough trailing days to complete the last row
    const remainder = days.length % 7
    if (remainder > 0) {
      const needed = 7 - remainder
      for (let i = 1; i <= needed; i++) {
        days.push({ date: new Date(year, month + 1, i), inMonth: false })
      }
    }

    return days
  }, [year, month])

  const postsForDay = (date: Date) =>
    posts.filter(p => {
      if (!p.scheduled_for) return false
      return isSameDay(new Date(p.scheduled_for), date)
    })

  const selectedDayPosts = selectedDay ? postsForDay(selectedDay) : []

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1))

  const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const goToToday = () => {
    setCurrentMonth(new Date())
    setSelectedDay(new Date())
  }

  return (
    <div className="flex gap-4 items-start">
      {/* Left: Calendar grid */}
      <Card padding="none" className="overflow-hidden flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200">
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={prevMonth} className="h-7 w-7 p-0">
              <CaretLeft size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={nextMonth} className="h-7 w-7 p-0">
              <CaretRight size={14} />
            </Button>
            <span className="text-sm font-semibold ml-1">{monthLabel}</span>
          </div>
          <Button variant="outline" size="sm" onClick={goToToday} className="h-7 text-xs">
            Today
          </Button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1.5 uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-200">
          {calendarDays.map(({ date, inMonth }, i) => {
            const dayPosts = postsForDay(date)
            const isToday = isSameDay(date, new Date())
            const isSelected = selectedDay && isSameDay(date, selectedDay)

            return (
              <button
                key={i}
                onClick={() => setSelectedDay(isSelected ? null : date)}
                className={`min-h-[80px] p-1.5 text-left transition-colors flex flex-col ${
                  inMonth ? 'bg-white' : 'bg-gray-50/50'
                } ${isSelected ? 'ring-2 ring-inset ring-[#F72D5E]/50 bg-[#F72D5E]/[0.03]' : ''} hover:bg-gray-50`}
              >
                {/* Day number */}
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-[11px] leading-none ${
                    isToday
                      ? 'bg-[#0C103D] text-white font-bold w-5 h-5 rounded-full flex items-center justify-center'
                      : inMonth ? 'text-gray-900 font-medium' : 'text-gray-300'
                  }`}>
                    {date.getDate()}
                  </span>
                  {dayPosts.length > 2 && (
                    <span className="text-[9px] text-gray-400">{dayPosts.length}</span>
                  )}
                </div>

                {/* Post teasers */}
                {dayPosts.length > 0 && (
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    {dayPosts.slice(0, 2).map(p => (
                      <PostTeaser key={p.id} post={p} onClick={() => router.push(`/content/${p.id}`)} />
                    ))}
                    {dayPosts.length > 2 && (
                      <span className="text-[9px] text-gray-400 text-center">
                        +{dayPosts.length - 2} more
                      </span>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </Card>

      {/* Right: Selected day detail panel (fixed width sidebar) */}
      <Card padding="none" className="w-[320px] shrink-0 overflow-hidden">
        {selectedDay ? (
          <>
            <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
              <p className="text-xs font-semibold">
                {selectedDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
              <span className="text-[10px] text-gray-400">
                {selectedDayPosts.length} post{selectedDayPosts.length !== 1 ? 's' : ''}
              </span>
            </div>

            {selectedDayPosts.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <CalendarBlank size={28} className="text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-400">No posts for this day</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 max-h-[calc(100vh-320px)] overflow-y-auto">
                {selectedDayPosts.map(p => {
                  const headline = p.visual_config?.blocks?.find((b: { type: string }) => b.type === 'headline') as { type: 'headline'; text: string } | undefined
                  const bodyBlock = p.visual_config?.blocks?.find((b: { type: string }) => b.type === 'text') as { type: 'text'; text: string } | undefined

                  return (
                    <button
                      key={p.id}
                      onClick={() => router.push(`/content/${p.id}`)}
                      className="w-full text-left flex gap-3 p-3 hover:bg-gray-50 transition-colors group"
                    >
                      {/* Mini post preview */}
                      <div className="w-12 h-15 rounded overflow-hidden border border-gray-200 shrink-0 shadow-sm group-hover:shadow-md transition-shadow">
                        <PostCardPreview config={p.visual_config} size={48} />
                      </div>

                      {/* Post info */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-start gap-1.5">
                          <span className="text-xs font-medium truncate flex-1">{p.title || headline?.text || 'Untitled'}</span>
                          <Badge variant={STATUS_BADGE_VARIANT[p.status] || 'default'} size="sm" className="shrink-0">
                            {SOCIAL_POST_STATUSES[p.status]?.label}
                          </Badge>
                        </div>
                        {bodyBlock && (
                          <p className="text-[11px] text-gray-400 truncate">{bodyBlock.text}</p>
                        )}
                        <div className="flex items-center gap-2 text-[10px] text-gray-400">
                          {p.scheduled_for && (
                            <span className="flex items-center gap-0.5">
                              <Clock size={9} />
                              {formatTime(p.scheduled_for)}
                            </span>
                          )}
                          <span className="flex items-center gap-0.5">
                            <PlatformIcon platform={p.platform} size={9} />
                            {p.platform === 'instagram' ? 'IG' : 'X'}
                          </span>
                          {p.status === 'published' && (
                            <span className="flex items-center gap-0.5 text-emerald-600">
                              <CheckCircle size={9} weight="fill" />
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-16 text-center">
            <CalendarBlank size={32} className="text-gray-200 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Click a day to see posts</p>
          </div>
        )}
      </Card>
    </div>
  )
}
