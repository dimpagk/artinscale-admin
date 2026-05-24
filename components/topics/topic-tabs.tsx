'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface TopicTabsProps {
  topicId: string;
  pendingCount: number;
  totalCount: number;
}

const TABS = [
  { id: 'edit', label: 'Edit' },
  { id: 'contributions', label: 'Contributions' },
] as const;

export function TopicTabs({ topicId, pendingCount, totalCount }: TopicTabsProps) {
  const searchParams = useSearchParams();
  const active = searchParams.get('tab') === 'contributions' ? 'contributions' : 'edit';

  return (
    <div className="mb-6 border-b border-gray-200">
      <nav className="-mb-px flex gap-6" aria-label="Topic sections">
        {TABS.map((t) => {
          const isActive = active === t.id;
          const href =
            t.id === 'edit'
              ? `/topics/${topicId}`
              : `/topics/${topicId}?tab=contributions`;
          return (
            <Link
              key={t.id}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2 border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label}
              {t.id === 'contributions' && totalCount > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    pendingCount > 0
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {pendingCount > 0 ? `${pendingCount} pending` : totalCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
