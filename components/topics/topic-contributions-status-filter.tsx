'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui/tabs';
import type { ContributionStatus } from '@/lib/types';

interface Props {
  topicId: string;
  currentStatus?: ContributionStatus;
  stats: { pending: number; approved: number; rejected: number; total: number };
}

export function TopicContributionsStatusFilter({
  topicId,
  currentStatus,
  stats,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setStatus = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'contributions');
    if (id) params.set('status', id);
    else params.delete('status');
    router.replace(`/topics/${topicId}?${params.toString()}`, { scroll: false });
  };

  const tabs = [
    { id: '', label: 'All', count: stats.total },
    { id: 'pending', label: 'Pending', count: stats.pending },
    { id: 'approved', label: 'Approved', count: stats.approved },
    { id: 'rejected', label: 'Rejected', count: stats.rejected },
  ];

  return (
    <Tabs
      tabs={tabs}
      activeTab={currentStatus ?? ''}
      onTabChange={setStatus}
    />
  );
}
