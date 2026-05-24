import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

/**
 * KPI tile used on the admin dashboard. Consistent height, hover, link
 * affordance. Replaces the inline `<Card>` + `<p>` + `<p>` pattern.
 */
interface StatCardProps {
  label: string
  value: ReactNode
  /** Tailwind text-color class for the value (e.g. 'text-brand-gold') */
  valueColorClass?: string
  href?: string
  description?: ReactNode
}

export function StatCard({
  label,
  value,
  valueColorClass = 'text-gray-900',
  href,
  description,
}: StatCardProps) {
  const inner = (
    <Card className={href ? 'transition-colors hover:border-gray-300' : ''}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${valueColorClass}`}>{value}</p>
      {description && (
        <p className="mt-2 text-xs text-gray-500">{description}</p>
      )}
    </Card>
  )

  return href ? <Link href={href}>{inner}</Link> : inner
}
