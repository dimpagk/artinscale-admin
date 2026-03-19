'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui/tabs';
import { Select } from '@/components/ui/select';

interface ContributionsFilterProps {
  currentStatus?: string;
  currentTopicId?: string;
  currentType?: string;
  topics: { value: string; label: string }[];
  stats: { pending: number; approved: number; rejected: number; total: number };
}

export function ContributionsFilter({
  currentStatus,
  currentTopicId,
  currentType,
  topics,
  stats,
}: ContributionsFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/contributions?${params.toString()}`);
  };

  const tabs = [
    { id: '', label: 'All', count: stats.total },
    { id: 'pending', label: 'Pending', count: stats.pending },
    { id: 'approved', label: 'Approved', count: stats.approved },
    { id: 'rejected', label: 'Rejected', count: stats.rejected },
  ];

  return (
    <div className="space-y-4">
      <Tabs
        tabs={tabs}
        activeTab={currentStatus || ''}
        onTabChange={(id) => updateParam('status', id)}
      />

      <div className="flex gap-4">
        <div className="w-48">
          <Select
            options={[{ value: '', label: 'All topics' }, ...topics]}
            value={currentTopicId || ''}
            onChange={(e) => updateParam('topic_id', e.target.value)}
          />
        </div>
        <div className="w-40">
          <Select
            options={[
              { value: '', label: 'All types' },
              { value: 'story', label: 'Story' },
              { value: 'photo', label: 'Photo' },
              { value: 'sound', label: 'Sound' },
              { value: 'link', label: 'Link' },
            ]}
            value={currentType || ''}
            onChange={(e) => updateParam('type', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
