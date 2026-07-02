import { Badge } from '@/components/ui/badge'

/**
 * Domain-aware status badge.
 *
 * Centralizes the status → variant mappings that were duplicated as
 * `const statusVariant = { ... }` in every list and edit page.
 *
 * Add a new domain by extending the `STATUS_MAP` below.
 */

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'secondary' | 'outline'

const STATUS_MAP = {
  artwork: {
    created: 'warning',
    listed: 'success',
    sold: 'secondary',
    retired: 'outline',
  },
  topic: {
    active: 'success',
    upcoming: 'warning',
    completed: 'secondary',
  },
  contribution: {
    pending: 'warning',
    approved: 'success',
    rejected: 'error',
  },
  social_post: {
    draft: 'default',
    scheduled: 'warning',
    published: 'success',
    failed: 'error',
  },
  posting: {
    pending: 'default',
    scheduled: 'warning',
    publishing: 'warning',
    published: 'success',
    failed: 'error',
  },
  external_print: {
    discovered: 'default',
    in_progress: 'warning',
    fetching: 'warning',
    upscaling: 'warning',
    rendering: 'warning',
    creating_gelato: 'warning',
    creating_shopify: 'warning',
    shopify_created: 'success',
    retired: 'secondary',
    error: 'error',
  },
} satisfies Record<string, Record<string, BadgeVariant>>

export type StatusDomain = keyof typeof STATUS_MAP

interface StatusBadgeProps<D extends StatusDomain> {
  domain: D
  status: keyof (typeof STATUS_MAP)[D] | string
  size?: 'sm' | 'md'
  /** Override the default label (which is just the status string). */
  label?: string
}

export function StatusBadge<D extends StatusDomain>({
  domain,
  status,
  size = 'sm',
  label,
}: StatusBadgeProps<D>) {
  const map = STATUS_MAP[domain] as Record<string, BadgeVariant>
  const variant = map[status as string] ?? 'default'
  return (
    <Badge variant={variant} size={size}>
      {label ?? String(status)}
    </Badge>
  )
}
