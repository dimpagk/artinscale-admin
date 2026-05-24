import type { ReactNode } from 'react'

/**
 * Inline label/value pair for description-list patterns inside Cards.
 *   <Field label="Email" value="user@example.com" />
 */
interface FieldProps {
  label: ReactNode
  value: ReactNode
  /** Optional CSS for the wrapper. */
  className?: string
}

export function Field({ label, value, className = '' }: FieldProps) {
  return (
    <div className={`flex gap-2 ${className}`.trim()}>
      <dt className="shrink-0 text-gray-500">{label}:</dt>
      <dd className="text-gray-900">{value}</dd>
    </div>
  )
}

/**
 * Wrap a list of Field components for proper dl semantics + a 2-column
 * layout on desktop.
 */
interface FieldListProps {
  children: ReactNode
  columns?: 1 | 2
  className?: string
}

export function FieldList({
  children,
  columns = 2,
  className = '',
}: FieldListProps) {
  const grid =
    columns === 2
      ? 'grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2'
      : 'grid grid-cols-1 gap-y-1 text-sm'
  return <dl className={`${grid} ${className}`.trim()}>{children}</dl>
}
