import type { ReactNode } from 'react'

/**
 * Subtitle metadata line used under PageHeader on edit pages.
 *
 * Renders dot-separated facts: "Maya Riso · Genesis · Edition: 0/100"
 * Skips empty / null values automatically.
 *
 * NOTE: This sits inside PageHeader's bottom margin via negative margin
 * so it visually pairs with the title rather than reading as its own
 * row. If you want a standalone meta row, set `className="mt-2"`.
 */
interface PageMetaProps {
  items: Array<ReactNode | null | undefined | false>
  className?: string
}

export function PageMeta({ items, className = '' }: PageMetaProps) {
  const visible = items.filter(
    (i): i is Exclude<typeof i, null | undefined | false> =>
      i !== null && i !== undefined && i !== false
  )
  if (visible.length === 0) return null

  return (
    <div
      className={`-mt-4 mb-6 text-sm text-gray-500 ${className}`.trim()}
    >
      {visible.map((item, idx) => (
        <span key={idx}>
          {item}
          {idx < visible.length - 1 && (
            <span className="mx-2 text-gray-300" aria-hidden="true">
              ·
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
