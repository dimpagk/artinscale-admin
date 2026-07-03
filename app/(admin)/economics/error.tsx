'use client';

import { useEffect } from 'react';

/**
 * Scoped error boundary for /economics. Keeps a failure on this page from
 * blanking the whole admin (the app shell stays), surfaces the real message
 * for a client-side error, and offers a retry.
 */
export default function EconomicsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[economics] render error:', error);
  }, [error]);

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6">
      <h2 className="text-sm font-semibold text-red-800">The economics page failed to load</h2>
      <p className="mt-1 text-sm text-red-700">{error.message || 'An unexpected error occurred.'}</p>
      {error.digest && <p className="mt-1 text-xs text-red-400">digest: {error.digest}</p>}
      <button
        onClick={reset}
        className="mt-4 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
      >
        Try again
      </button>
    </div>
  );
}
