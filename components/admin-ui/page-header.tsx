import type { ReactNode } from 'react'
import Link from 'next/link'
import { Badge } from '@dimpagk/artinscale-ui/display'
import { ButtonLink } from '@dimpagk/artinscale-ui/navigation'

/**
 * Standard admin page header.
 *
 * Replaces the `<h1 className="mb-6 text-2xl font-bold text-gray-900">`
 * pattern that was duplicated across 11 admin pages, plus the ad-hoc
 * `<div className="flex items-center justify-between">` wrapper used
 * for headers with action buttons.
 *
 * Usage:
 *   <PageHeader title="Artworks" />
 *   <PageHeader title="Artworks" action={{ href: '/artworks/new', label: 'New Artwork' }} />
 *   <PageHeader title="Edit: My Piece" badge={{ label: 'listed', variant: 'success' }} />
 *   <PageHeader title="Inbox" description="3 pending items" />
 */
export interface PageHeaderAction {
  href: string
  label: string
  variant?: 'primary' | 'secondary'
}

export interface PageHeaderBadge {
  label: string
  variant?: 'default' | 'success' | 'warning' | 'error' | 'secondary' | 'outline'
}

interface PageHeaderProps {
  title: string
  description?: ReactNode
  badge?: PageHeaderBadge
  action?: PageHeaderAction | ReactNode
}

export function PageHeader({ title, description, badge, action }: PageHeaderProps) {
  const actionNode = isAction(action) ? (
    <ButtonLink href={action.href} variant={action.variant ?? 'primary'} size="sm">
      {action.label}
    </ButtonLink>
  ) : (
    action ?? null
  )

  return (
    <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {badge && (
            <Badge variant={badge.variant ?? 'default'} size="sm">
              {badge.label}
            </Badge>
          )}
        </div>
        {description && (
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        )}
      </div>
      {actionNode && <div className="shrink-0">{actionNode}</div>}
    </header>
  )
}

function isAction(value: unknown): value is PageHeaderAction {
  return (
    typeof value === 'object' &&
    value !== null &&
    'href' in (value as Record<string, unknown>) &&
    'label' in (value as Record<string, unknown>)
  )
}

// Re-export Link so callers don't need a separate import for "back to list" links
export { Link as PageHeaderLink }
