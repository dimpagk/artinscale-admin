import type { ReactNode } from 'react'
import Link from 'next/link'
import { ButtonLink } from '@dimpagk/artinscale-ui/navigation'

/**
 * Empty state placeholder for tables, lists, and queues.
 *
 * Replaces the ad-hoc "No X yet. Create your first X." rows scattered
 * across the admin pages with a consistent visual.
 */
interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: { href: string; label: string }
  icon?: ReactNode
  /** "row" renders inline (for table tbody fallbacks); "block" renders as a centered card */
  variant?: 'row' | 'block'
  /** Used by "row" variant — number of columns to span */
  colSpan?: number
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  variant = 'block',
  colSpan = 1,
}: EmptyStateProps) {
  const body = (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      {icon && <div className="text-gray-300">{icon}</div>}
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-gray-500">{description}</p>
      )}
      {action && (
        <div className="mt-2">
          <ButtonLink href={action.href} variant="primary" size="sm">
            {action.label}
          </ButtonLink>
        </div>
      )}
    </div>
  )

  if (variant === 'row') {
    return (
      <tr>
        <td colSpan={colSpan} className="px-6 text-center text-sm text-gray-500">
          {body}
        </td>
      </tr>
    )
  }

  return body
}

// Reused by callers that want to construct their own footer link
export { Link as EmptyStateLink }
