'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface GenerateContributionsButtonProps {
  topicId: string;
}

type Result = { type: 'success' | 'error'; message: string } | null;

export function GenerateContributionsButton({ topicId }: GenerateContributionsButtonProps) {
  const router = useRouter();
  const [count, setCount] = useState(5);
  const [instructions, setInstructions] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [refineLoading, setRefineLoading] = useState(false);
  const [genResult, setGenResult] = useState<Result>(null);
  const [refineResult, setRefineResult] = useState<Result>(null);

  const pendingHref = `/contributions?status=pending&topic_id=${encodeURIComponent(topicId)}`;

  const handleGenerate = async () => {
    setGenLoading(true);
    setGenResult(null);

    try {
      const res = await fetch(`/api/topics/${topicId}/generate-contributions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, instructions: instructions.trim() || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setGenResult({ type: 'error', message: data.error || 'Generation failed' });
      } else {
        setGenResult({ type: 'success', message: 'Queued — see status above' });
        router.refresh();
      }
    } catch {
      setGenResult({ type: 'error', message: 'Network error' });
    } finally {
      setGenLoading(false);
    }
  };

  const handleRefine = async () => {
    if (!instructions.trim()) {
      setRefineResult({ type: 'error', message: 'Add instructions first' });
      return;
    }
    setRefineLoading(true);
    setRefineResult(null);

    try {
      const res = await fetch(`/api/topics/${topicId}/refine-contributions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: instructions.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRefineResult({ type: 'error', message: data.error || 'Refinement failed' });
      } else {
        setRefineResult({ type: 'success', message: 'Queued — see status above' });
        router.refresh();
      }
    } catch {
      setRefineResult({ type: 'error', message: 'Network error' });
    } finally {
      setRefineLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Count"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleGenerate}
          disabled={genLoading}
          loading={genLoading}
        >
          Generate
        </Button>
      </div>
      {genResult && (
        <p className={`text-xs ${genResult.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
          {genResult.message}{' '}
          {genResult.type === 'success' && (
            <Link href={pendingHref} className="underline hover:no-underline">
              Review pending →
            </Link>
          )}
        </p>
      )}

      <div className="border-t border-gray-200 pt-3 space-y-2">
        <Textarea
          label="Style instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="e.g. no em-dashes, less dramatic, more conversational"
          helperText="Applied to new generations. Also enables bulk refinement of all pending seeds."
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRefine}
          disabled={refineLoading || !instructions.trim()}
          loading={refineLoading}
          title={!instructions.trim() ? 'Type style instructions above to enable' : 'Rewrite all pending seeds for this topic'}
        >
          Refine all pending seeds
        </Button>
        {!instructions.trim() && (
          <p className="text-[11px] text-gray-400">
            Or select specific contributions in the list and use &quot;Refine N&quot; in the toolbar.
          </p>
        )}
        {refineResult && (
          <p className={`text-xs ${refineResult.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
            {refineResult.message}
          </p>
        )}
      </div>

      <Link
        href={pendingHref}
        className="block text-xs text-gray-500 hover:text-gray-900"
      >
        View pending for this topic →
      </Link>
    </div>
  );
}
