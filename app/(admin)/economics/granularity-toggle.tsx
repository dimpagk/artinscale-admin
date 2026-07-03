'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { GRANULARITIES, type PnlGranularity } from '@/lib/costs/pnl';

const LABELS: Record<PnlGranularity, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};

/**
 * Period-granularity switch. Writes `?g=` so the server component re-renders
 * the whole P&L for the chosen bucket — no client-side data fetching.
 */
export function GranularityToggle({ value }: { value: PnlGranularity }) {
  const router = useRouter();
  const params = useSearchParams();

  function select(g: PnlGranularity) {
    const next = new URLSearchParams(params.toString());
    next.set('g', g);
    next.delete('from'); // range resets to the granularity's default
    next.delete('to');
    router.push(`/economics?${next.toString()}`);
  }

  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
      {GRANULARITIES.map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => select(g)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            g === value ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          {LABELS[g]}
        </button>
      ))}
    </div>
  );
}
