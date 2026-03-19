'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { approveContribution, rejectContribution } from '@/app/(admin)/contributions/actions';

export function ContributionActions({ contributionId }: { contributionId: string }) {
  const router = useRouter();
  const [adminNotes, setAdminNotes] = useState('');
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);

  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(action);
    const fn = action === 'approve' ? approveContribution : rejectContribution;
    const result = await fn(contributionId, adminNotes || undefined);

    if (result.success) {
      toast.success(`Contribution ${action === 'approve' ? 'approved' : 'rejected'}`);
      router.push('/contributions');
    } else {
      toast.error(result.error || 'Something went wrong');
    }
    setLoading(null);
  };

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Actions</h2>
      <Textarea
        label="Admin Notes (optional)"
        value={adminNotes}
        onChange={(e) => setAdminNotes(e.target.value)}
        rows={3}
        placeholder="Add a note about this decision..."
      />
      <div className="mt-4 flex gap-3">
        <Button
          onClick={() => handleAction('approve')}
          loading={loading === 'approve'}
          disabled={loading !== null}
        >
          Approve
        </Button>
        <Button
          variant="danger"
          onClick={() => handleAction('reject')}
          loading={loading === 'reject'}
          disabled={loading !== null}
        >
          Reject
        </Button>
      </div>
    </Card>
  );
}
