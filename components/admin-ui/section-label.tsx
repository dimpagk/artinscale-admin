import type { ReactNode } from 'react'

/**
 * Small uppercase label used inside Cards as a sub-section heading.
 * Replaces the hand-rolled `<h2 className="text-xs font-semibold uppercase">`
 * pattern in contribution detail and similar places.
 */
interface SectionLabelProps {
  children: ReactNode
  className?: string
}

export function SectionLabel({ children, className = '' }: SectionLabelProps) {
  return (
    <h2
      className={`mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${className}`.trim()}
    >
      {children}
    </h2>
  )
}
