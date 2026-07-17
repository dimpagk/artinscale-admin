import Link from 'next/link'

/**
 * Link-based pagination footer for admin list pages. Server-rendered:
 * builds Prev / Next hrefs from the current filter params so paging
 * preserves active filters. Renders nothing when everything fits on
 * one page.
 */
interface PaginationProps {
  page: number
  pageSize: number
  total: number
  basePath: string
  /** Current filter params to preserve in page links. */
  params?: Record<string, string | undefined>
}

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params = {},
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null

  const hrefFor = (p: number) => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value) qs.set(key, value)
    }
    if (p > 1) qs.set('page', String(p))
    const s = qs.toString()
    return s ? `${basePath}?${s}` : basePath
  }

  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  const navClass =
    'rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-navy/40 hover:text-brand-navy'
  const disabledClass =
    'rounded-md border border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-300'

  return (
    <nav
      className="flex items-center justify-between"
      aria-label="Pagination"
    >
      <p className="text-xs text-gray-500">
        Showing {from}-{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={navClass}>
            Previous
          </Link>
        ) : (
          <span className={disabledClass}>Previous</span>
        )}
        <span className="px-1 text-xs text-gray-500">
          Page {page} of {pageCount}
        </span>
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={navClass}>
            Next
          </Link>
        ) : (
          <span className={disabledClass}>Next</span>
        )}
      </div>
    </nav>
  )
}
