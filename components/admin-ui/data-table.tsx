import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

/**
 * Shared table layout for admin list pages.
 *
 * Wraps a Card-bordered table with a sticky header style and consistent
 * padding. Caller supplies the column definitions and a row renderer
 * — much less duplicated <thead>/<tbody> markup than the previous
 * pattern across artworks, contributions, artists, topics pages.
 */

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** Tailwind width class — e.g. 'w-24' or 'min-w-[200px]'. Optional. */
  width?: string
  align?: 'left' | 'right' | 'center'
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
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  emptyState,
  onRowClick,
  className,
}: DataTableProps<T>) {
  return (
    <Card padding="none" className={className}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/50 text-left text-xs uppercase tracking-wide text-gray-500">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={[
                    'px-4 py-2.5 font-semibold',
                    col.width ?? '',
                    col.align === 'right' ? 'text-right' : '',
                    col.align === 'center' ? 'text-center' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {col.header}
                </th>
              ))}
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
