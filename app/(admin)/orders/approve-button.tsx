'use client';

import { useTransition } from 'react';

/**
 * Approve triggers real production at Gelato: it charges the print cost
 * and ships a physical item. We gate it behind a confirm so it can never
 * fire on a stray click.
 */
export function ApproveButton({
  action,
  confirmText,
}: {
  action: () => Promise<void>;
  confirmText: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        startTransition(() => action());
      }}
      className="rounded-lg bg-[var(--brand-navy)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Approving…' : 'Approve and send to production'}
    </button>
  );
}
