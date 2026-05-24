import type { ReactNode } from 'react'

/**
 * Two-column layout for edit / detail pages.
 *
 * Main content (forms, primary content) goes in the wide left column.
 * The sidebar (stats, actions, integrations, related entities) sits on
 * the right. Collapses to a single stacked column below `lg`.
 *
 * Use this on topic edit, artwork edit, contribution detail, etc — any
 * page that previously had a 3xl-capped center column with metadata
 * crammed above the form.
 */
interface EditPageLayoutProps {
  main: ReactNode
  sidebar: ReactNode
  className?: string
}

export function EditPageLayout({ main, sidebar, className = '' }: EditPageLayoutProps) {
  return (
    <div
      className={`grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] ${className}`.trim()}
    >
      <div className="min-w-0">{main}</div>
      <aside className="space-y-4">{sidebar}</aside>
    </div>
  )
}
