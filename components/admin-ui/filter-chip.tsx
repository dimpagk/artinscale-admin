import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'

/**
 * Pill-style filter link used at the top of list pages. Renders an
 * anchor (so it works for SSR / share-able URLs) with an optional
 * count badge.
 */
interface FilterChipProps {
  label: ReactNode
  href: string
  active?: boolean
  /** When set + > 0, renders a count badge after the label. */
  count?: number
}

export function FilterChip({ label, href, active = false, count }: FilterChipProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-brand-navy bg-brand-navy text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:border-brand-navy/40 hover:text-brand-navy'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
      {count !== undefined && count > 0 && (
        <Badge variant={active ? 'secondary' : 'warning'} size="sm">
          {count}
        </Badge>
      )}
    </Link>
  )
}
