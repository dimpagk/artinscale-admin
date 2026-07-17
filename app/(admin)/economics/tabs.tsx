'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/economics', label: 'Overview' },
  { href: '/economics/pricing', label: 'Pricing' },
  { href: '/economics/bid-caps', label: 'Bid caps' },
] as const;

export function EconomicsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {TABS.map((t) => {
        // Overview matches only the exact path; the others own their subtree.
        const active =
          t.href === '/economics'
            ? pathname === '/economics'
            : pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
