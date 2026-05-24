'use client'

import { useEffect, useState } from 'react'

/**
 * "5m ago" / "2h ago" / "3d ago" relative time label. Hydration-safe:
 * SSR renders the absolute date, then the client swaps in the relative
 * label after mount.
 */
interface RelativeTimeProps {
  date: string | Date
  /** Optional className for the rendered span. */
  className?: string
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const target = typeof date === 'string' ? new Date(date) : date
  const [label, setLabel] = useState(() => target.toLocaleDateString())

  useEffect(() => {
    const update = () => setLabel(formatRelative(target))
    update()
    const id = setInterval(update, 30_000) // re-tick every 30s
    return () => clearInterval(id)
  }, [target])

  return (
    <time
      dateTime={target.toISOString()}
      title={target.toLocaleString()}
      className={className}
    >
      {label}
    </time>
  )
}

function formatRelative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  // Older than ~1 month — render the actual date
  return date.toLocaleDateString()
}
