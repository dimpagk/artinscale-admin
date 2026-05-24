import Link from 'next/link'
import type { ReactNode } from 'react'
import { CaretLeft } from '@phosphor-icons/react/dist/ssr'

/**
 * Small "← Back to X" link rendered above PageHeader on detail pages.
 *
 * Renders tight against the PageHeader so the visual hierarchy reads
 * `Back link → Title`. Uses the phosphor caret for a sharper look than
 * the literal arrow character.
 */
interface BackLinkProps {
  href: string
  children: ReactNode
}

export function BackLink({ href, children }: BackLinkProps) {
  return (
    <div className="mb-3">
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-900"
      >
        <CaretLeft size={12} weight="bold" />
        {children}
      </Link>
    </div>
  )
}
