'use client'

import { useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

/**
 * URL-driven filter toolbar for admin list pages: a debounced free-text
 * search (`q` param) plus any number of select filters, each bound to
 * its own query param. Server components read the same params to filter
 * the query, so filtered views stay shareable / refreshable.
 *
 * Any change resets the `page` param so pagination restarts at page 1.
 */
export interface TableFilterSelect {
  /** Query param the select writes, e.g. 'status'. */
  param: string
  /** Label of the empty option, e.g. 'All statuses'. */
  allLabel: string
  options: { value: string; label: string }[]
}

interface TableFiltersProps {
  searchPlaceholder?: string
  selects?: TableFilterSelect[]
}

const SEARCH_DEBOUNCE_MS = 300

export function TableFilters({
  searchPlaceholder = 'Search…',
  selects = [],
}: TableFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')

  const apply = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    params.delete('page')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const onSearchChange = (value: string) => {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      apply((params) => {
        const trimmed = value.trim()
        if (trimmed) params.set('q', trimmed)
        else params.delete('q')
      })
    }, SEARCH_DEBOUNCE_MS)
  }

  const clearAll = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearch('')
    router.replace(pathname, { scroll: false })
  }

  const hasActiveFilters =
    !!searchParams.get('q') || selects.some((s) => !!searchParams.get(s.param))

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-64">
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search"
        />
      </div>
      {selects.map((s) => (
        <div key={s.param} className="w-44">
          <Select
            options={[{ value: '', label: s.allLabel }, ...s.options]}
            value={searchParams.get(s.param) ?? ''}
            aria-label={s.allLabel}
            onChange={(e) =>
              apply((params) => {
                if (e.target.value) params.set(s.param, e.target.value)
                else params.delete(s.param)
              })
            }
          />
        </div>
      ))}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
