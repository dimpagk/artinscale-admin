import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * Sync-status card used inside the artwork edit page for Gelato + Shopify
 * (and any future external integration). Shows synced/not-synced state +
 * the external identifier when present + an optional action button.
 */
interface IntegrationStatusCardProps {
  /** Human-readable name (Gelato, Shopify, Meta, etc.) */
  name: string
  /** True when the integration has actually persisted an external id */
  synced: boolean
  /** Label for the external id display ("Product ID", "Handle", etc.) */
  identifierLabel?: string
  /** The external identifier value, when synced */
  identifierValue?: string | null
  /** Optional action button rendered on the right when not synced */
  action?: ReactNode
  /** Body slot for any additional content (e.g. a "Mark as Listed" form) */
  children?: ReactNode
}

export function IntegrationStatusCard({
  name,
  synced,
  identifierLabel = 'ID',
  identifierValue,
  action,
  children,
}: IntegrationStatusCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900">{name}</p>
          {synced && identifierValue ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="success" size="sm">
                Synced
              </Badge>
              <span className="truncate font-mono text-xs text-gray-500">
                {identifierLabel}: {identifierValue}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-500">Not synced</p>
          )}
        </div>
        {!synced && action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  )
}
