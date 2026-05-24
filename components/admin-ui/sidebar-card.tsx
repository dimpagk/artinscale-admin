import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

/**
 * Compact card used in the right-rail of EditPageLayout. Smaller padding
 * and tighter type than FormCard since sidebar real estate is narrow.
 */
interface SidebarCardProps {
  title?: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  padding?: 'sm' | 'md' | 'lg'
  className?: string
}

export function SidebarCard({
  title,
  description,
  action,
  children,
  padding = 'md',
  className,
}: SidebarCardProps) {
  return (
    <Card padding={padding} className={className}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            {title && (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {title}
              </h3>
            )}
            {description && (
              <p className="text-xs text-gray-500">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </Card>
  )
}
