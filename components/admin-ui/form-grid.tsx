import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

/**
 * Grid wrapper for paired or triple fields inside a form. Replaces the
 * `<div className="grid grid-cols-{N} gap-4">` markup repeated in every
 * form file.
 */
interface FormGridProps {
  columns?: 2 | 3 | 4
  children: ReactNode
  /** Add gap-y separately if you need denser horizontal vs vertical. */
  className?: string
}

const COLS = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const

export function FormGrid({ columns = 2, children, className = '' }: FormGridProps) {
  return (
    <div className={`grid gap-4 ${COLS[columns]} ${className}`.trim()}>
      {children}
    </div>
  )
}

/**
 * Visual section header used inside a form to group related fields.
 *
 * Use the bare `<FormSection>` when the surrounding layout already
 * provides separation (e.g. inside a parent Card). Most edit pages
 * should reach for `<FormCard>` instead — it adds a Card surface so the
 * section reads as a self-contained block on the gray page background.
 */
interface FormSectionProps {
  title: string
  description?: ReactNode
  /** Optional action rendered to the right of the title (e.g. "Add variant"). */
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function FormSection({
  title,
  description,
  action,
  children,
  className = '',
}: FormSectionProps) {
  return (
    <section className={`space-y-4 ${className}`.trim()}>
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {description && (
            <p className="text-sm text-gray-500">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  )
}

/**
 * Card-wrapped form section — the standard "block of related fields"
 * surface on every edit page. Encapsulates the previously repeated
 * `<Card><FormSection>...</FormSection></Card>` pattern.
 *
 * Pass `padding="sm"` when the section content is dense (e.g. a list
 * of small switches). Default `md` matches the design-system Card.
 */
interface FormCardProps extends FormSectionProps {
  padding?: 'sm' | 'md' | 'lg'
}

export function FormCard({
  padding = 'md',
  children,
  className,
  ...sectionProps
}: FormCardProps) {
  return (
    <Card padding={padding}>
      <FormSection {...sectionProps} className={className}>
        {children}
      </FormSection>
    </Card>
  )
}
