import type { ReactNode } from 'react';
import { PageHeader } from '@/components/admin-ui';
import { EconomicsTabs } from './tabs';

// Economics is the money hub: P&L (Overview), Pricing, and per-market ad
// Bid caps share one header + tab bar. Each tab is its own nested route so
// it keeps server-side data loading and stays deep-linkable.
export default function EconomicsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Economics"
        description="P&L, pricing, and per-market ad economics — the money view."
      />
      <EconomicsTabs />
      {children}
    </div>
  );
}
