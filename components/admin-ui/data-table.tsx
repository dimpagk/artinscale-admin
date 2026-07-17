import type { ReactNode } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'

/**
 * Shared table layout for admin list pages.
 *
 * Wraps a Card-bordered table with a sticky header style and consistent
 * padding. Caller supplies the column definitions and a row renderer
 * — much less duplicated <thead>/<tbody> markup than the previous
 * pattern across artworks, contributions, artists, topics pages.
 *
 * Columns opt into sorting by declaring a `sortKey`; pass a `sort`
 * config and those headers become links that toggle direction via URL
 * params, so sorting stays server-side and shareable like the filters.
 */

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** Tailwind width class — e.g. 'w-24' or 'min-w-[200px]'. Optional. */
  width?: string
  align?: 'left' | 'right' | 'center'
  /**
   * URL sort value for this column. When set and the table's `sort`
   * prop is provided, the header renders as a toggle link. Must match
   * a key the server understands.
   */
  sortKey?: string
}

export interface DataTableSort {
  /** Active sort key from the URL (matches a column's sortKey). */
  key?: string
  dir?: 'asc' | 'desc'
  basePath: string
  /** Filter params to preserve when building sort links. */
  params?: Record<string, string | undefined>
  /** Direction applied the first time a column is clicked. Default 'asc'. */
  defaultDir?: 'asc' | 'desc'
}

interface DataTableProps<T> {
  rows: T[]
  columns: DataTableColumn<T>[]
  rowKey: (row: T) => string
  /** Fallback rendered inside the tbody when rows is empty */
  emptyState?: ReactNode
  /** Optional click handler; if supplied, rows get hover styling + cursor */
  onRowClick?: (row: T) => void
  /** Add a custom className to the wrapping Card */
  className?: string
  /** Enables sortable headers for columns that declare a `sortKey`. */
  sort?: DataTableSort
}

function buildSortHref(
  sort: DataTableSort,
  key: string,
  dir: 'asc' | 'desc'
): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sort.params ?? {})) {
    if (v) qs.set(k, v)
  }
  qs.set('sort', key)
  qs.set('dir', dir)
  const s = qs.toString()
  return s ? `${sort.basePath}?${s}` : sort.basePath
}

/** Small stacked-caret indicator: solid in the active direction, faded when idle. */
function SortGlyph({ state }: { state: 'asc' | 'desc' | 'none' }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5 L6 2.5 L9 5" className={state === 'asc' ? '' : 'opacity-30'} />
      <path d="M3 7 L6 9.5 L9 7" className={state === 'desc' ? '' : 'opacity-30'} />
    </svg>
  )
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  emptyState,
  onRowClick,
  className,
  sort,
}: DataTableProps<T>) {
  return (
    <Card padding="none" className={className}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/50 text-left text-xs uppercase tracking-wide text-gray-500">
              {columns.map((col) => {
                const sortable = sort && col.sortKey
                const isActive = sortable && sort!.key === col.sortKey
                const activeDir = isActive ? sort!.dir ?? 'asc' : undefined
                const nextDir: 'asc' | 'desc' = isActive
                  ? activeDir === 'asc'
                    ? 'desc'
                    : 'asc'
                  : sort?.defaultDir ?? 'asc'
                return (
                  <th
                    key={col.key}
                    aria-sort={
                      isActive
                        ? activeDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                    className={[
                      'px-4 py-2.5 font-semibold',
                      col.width ?? '',
                      col.align === 'right' ? 'text-right' : '',
                      col.align === 'center' ? 'text-center' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {sortable ? (
                      <Link
                        href={buildSortHref(sort!, col.sortKey!, nextDir)}
                        scroll={false}
                        className={[
                          'inline-flex items-center gap-1 transition-colors hover:text-gray-900',
                          col.align === 'right' ? 'flex-row-reverse' : '',
                          isActive ? 'text-gray-900' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {col.header}
                        <SortGlyph state={isActive ? activeDir! : 'none'} />
                      </Link>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-2">
                  {emptyState ?? (
                    <p className="py-6 text-center text-sm text-gray-500">No rows.</p>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={onRowClick ? 'cursor-pointer hover:bg-gray-50' : 'hover:bg-gray-50'}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        'px-4 py-3 text-sm',
                        col.align === 'right' ? 'text-right' : '',
                        col.align === 'center' ? 'text-center' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
