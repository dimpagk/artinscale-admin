'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState, Field, FieldList, SectionLabel, StatusBadge } from '@/components/admin-ui';
import {
  approveContribution,
  rejectContribution,
  reopenContribution,
  bulkUpdateContributions,
  bulkDeleteContributions,
  restoreContributionVersion,
} from '@/app/(admin)/contributions/actions';
import { DeleteConfirmModal } from '@/components/admin-ui';
import type { Contribution, ContributionVersion } from '@/lib/types';

type DiffSeg = { type: 'equal' | 'add' | 'remove'; text: string };

function tokenizeForDiff(s: string): string[] {
  return s.match(/\S+|\s+/g) ?? [];
}

function wordDiff(before: string, after: string): DiffSeg[] {
  const a = tokenizeForDiff(before);
  const b = tokenizeForDiff(after);
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      dp[i + 1][j + 1] =
        a[i] === b[j] ? dp[i][j] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffSeg[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ type: 'equal', text: a[i - 1] });
      i--;
      j--;
    } else if (dp[i][j - 1] >= dp[i - 1][j]) {
      out.push({ type: 'add', text: b[j - 1] });
      j--;
    } else {
      out.push({ type: 'remove', text: a[i - 1] });
      i--;
    }
  }
  while (i > 0) {
    out.push({ type: 'remove', text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    out.push({ type: 'add', text: b[j - 1] });
    j--;
  }
  out.reverse();
  const merged: DiffSeg[] = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

function DiffView({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p className="whitespace-pre-wrap break-words text-gray-700">
      {segments.map((seg, i) => {
        if (seg.type === 'remove') {
          return (
            <span
              key={i}
              className="bg-red-50 text-red-700 line-through decoration-red-400"
            >
              {seg.text}
            </span>
          );
        }
        if (seg.type === 'add') {
          return (
            <span key={i} className="bg-green-50 text-green-800">
              {seg.text}
            </span>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </p>
  );
}

function VersionDiff({
  version,
  newerContent,
  newerCaption,
}: {
  version: ContributionVersion;
  newerContent: string;
  newerCaption: string | null;
}) {
  const olderContent = version.content ?? '';
  const olderCaption = version.caption ?? '';
  const captionDiffers = olderCaption !== (newerCaption ?? '');
  return (
    <div className="mt-1.5 space-y-1.5">
      <DiffView before={olderContent} after={newerContent} />
      {captionDiffers && (
        <div>
          <span className="block text-[10px] uppercase tracking-wide text-gray-500">
            caption
          </span>
          <DiffView before={olderCaption} after={newerCaption ?? ''} />
        </div>
      )}
    </div>
  );
}

interface RefineTarget {
  topicId: string;
  ids: string[];
}

interface ContributionsListProps {
  contributions: Contribution[];
  emptyTitle?: string;
  emptyDescription?: string;
}

export function ContributionsList({
  contributions,
  emptyTitle = 'No contributions match',
  emptyDescription = 'Try clearing filters or wait for the next round of contributions.',
}: ContributionsListProps) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState<'approve' | 'reject' | 'delete' | null>(null);
  const [refineTarget, setRefineTarget] = useState<RefineTarget | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // For modal navigation: count of selected items that are deletable
  const deletableSelectedIds = useMemo(() => {
    return contributions
      .filter((c) => selected.has(c.id) && c.source === 'studio_seed' && c.status === 'pending')
      .map((c) => c.id);
  }, [contributions, selected]);

  const selectablePendingIds = useMemo(
    () => contributions.filter((c) => c.status === 'pending').map((c) => c.id),
    [contributions]
  );

  const selectedSeedsByTopic = useMemo(() => {
    const byTopic = new Map<string, string[]>();
    for (const c of contributions) {
      if (!selected.has(c.id)) continue;
      if (c.source !== 'studio_seed') continue;
      if (c.status !== 'pending') continue;
      const list = byTopic.get(c.topic_id) ?? [];
      list.push(c.id);
      byTopic.set(c.topic_id, list);
    }
    return byTopic;
  }, [contributions, selected]);

  const refinable = useMemo(() => {
    if (selectedSeedsByTopic.size === 0) return null;
    if (selectedSeedsByTopic.size > 1) return 'multi-topic' as const;
    const [topicId, ids] = Array.from(selectedSeedsByTopic.entries())[0];
    return { topicId, ids };
  }, [selectedSeedsByTopic]);

  // Drop selections that no longer match the current list (e.g. after a refresh / filter change)
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      const valid = new Set(selectablePendingIds);
      prev.forEach((id) => valid.has(id) && next.add(id));
      return next.size === prev.size ? prev : next;
    });
  }, [selectablePendingIds]);

  const active = activeId ? contributions.find((c) => c.id === activeId) ?? null : null;
  const allPendingSelected =
    selectablePendingIds.length > 0 && selected.size === selectablePendingIds.length;
  const someSelected = selected.size > 0;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allPendingSelected ? new Set() : new Set(selectablePendingIds));
  };

  const handleBulkDelete = async () => {
    if (deletableSelectedIds.length === 0) return;
    setBulkLoading('delete');
    const result = await bulkDeleteContributions(deletableSelectedIds);
    if (result.success) {
      toast.success(`Deleted ${result.deleted} contribution${result.deleted === 1 ? '' : 's'}`);
      setSelected(new Set());
      setShowDeleteConfirm(false);
      router.refresh();
    } else {
      toast.error(result.error || 'Delete failed');
    }
    setBulkLoading(null);
  };

  const navigateActive = (delta: 1 | -1) => {
    if (!activeId) return;
    const idx = contributions.findIndex((c) => c.id === activeId);
    if (idx === -1) return;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= contributions.length) return;
    setActiveId(contributions[nextIdx].id);
  };

  const handleBulk = async (action: 'approve' | 'reject') => {
    if (selected.size === 0) return;
    setBulkLoading(action);
    const result = await bulkUpdateContributions(Array.from(selected), action === 'approve' ? 'approved' : 'rejected');

    if (result.success) {
      toast.success(`${action === 'approve' ? 'Approved' : 'Rejected'} ${result.updated} contribution${result.updated === 1 ? '' : 's'}`);
      if (result.error) toast.error(`Some failed: ${result.error}`);
      setSelected(new Set());
      router.refresh();
    } else {
      toast.error(result.error || 'Bulk update failed');
    }
    setBulkLoading(null);
  };

  if (contributions.length === 0) {
    return (
      <Card>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </Card>
    );
  }

  return (
    <>
      <Card padding="none">
        {selectablePendingIds.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-2">
            <Checkbox
              checked={allPendingSelected}
              onChange={toggleAll}
              label={
                someSelected
                  ? `${selected.size} selected`
                  : `Select all pending (${selectablePendingIds.length})`
              }
            />
            {someSelected && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleBulk('approve')}
                  loading={bulkLoading === 'approve'}
                  disabled={bulkLoading !== null}
                >
                  Approve {selected.size}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleBulk('reject')}
                  loading={bulkLoading === 'reject'}
                  disabled={bulkLoading !== null}
                >
                  Reject {selected.size}
                </Button>
                {refinable && refinable !== 'multi-topic' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRefineTarget(refinable)}
                    disabled={bulkLoading !== null}
                    title="Rewrite selected seeds with style instructions"
                  >
                    Refine {refinable.ids.length}
                  </Button>
                )}
                {refinable === 'multi-topic' && (
                  <span
                    className="text-xs text-gray-400"
                    title="Refine works one topic at a time"
                  >
                    Refine: select one topic
                  </span>
                )}
                {deletableSelectedIds.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={bulkLoading !== null}
                    title="Permanently delete selected pending studio seeds"
                    className="text-red-600 hover:bg-red-50"
                  >
                    Delete {deletableSelectedIds.length}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                  disabled={bulkLoading !== null}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        )}

        <ul className="divide-y divide-gray-100">
          {contributions.map((c) => (
            <ContributionPreviewRow
              key={c.id}
              contribution={c}
              selected={selected.has(c.id)}
              onToggle={() => toggleOne(c.id)}
              onReview={() => setActiveId(c.id)}
            />
          ))}
        </ul>
      </Card>

      <ContributionReviewModal
        contribution={active}
        onClose={() => setActiveId(null)}
        onPrev={() => navigateActive(-1)}
        onNext={() => navigateActive(1)}
        hasPrev={
          activeId ? contributions.findIndex((c) => c.id === activeId) > 0 : false
        }
        hasNext={
          activeId
            ? contributions.findIndex((c) => c.id === activeId) <
              contributions.length - 1
            : false
        }
        position={
          activeId
            ? {
                index: contributions.findIndex((c) => c.id === activeId) + 1,
                total: contributions.length,
              }
            : null
        }
      />

      <RefineSelectedModal
        target={refineTarget}
        onClose={() => setRefineTarget(null)}
        onSuccess={() => {
          setSelected(new Set());
          setRefineTarget(null);
          router.refresh();
        }}
      />

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title={`Delete ${deletableSelectedIds.length} pending seed${deletableSelectedIds.length === 1 ? '' : 's'}`}
        body={
          <>
            Permanently delete {deletableSelectedIds.length} pending studio-seed
            contribution{deletableSelectedIds.length === 1 ? '' : 's'}? This
            cannot be undone. Real community submissions in your selection will
            be skipped.
          </>
        }
        confirmLabel="Delete forever"
        onConfirm={handleBulkDelete}
        pending={bulkLoading === 'delete'}
      />
    </>
  );
}

interface RefineModalProps {
  target: RefineTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}

function RefineSelectedModal({ target, onClose, onSuccess }: RefineModalProps) {
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (target) setInstructions('');
    setLoading(false);
  }, [target]);

  const handleApply = async () => {
    if (!target || !instructions.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/topics/${target.topicId}/refine-contributions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: instructions.trim(), ids: target.ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Refinement failed');
        setLoading(false);
        return;
      }
      toast.success(`Queued refinement of ${target.ids.length} contributions`);
      onSuccess();
    } catch {
      toast.error('Network error');
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={loading ? () => undefined : onClose}
      size="md"
      title="Refine selected seeds"
      actions={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            loading={loading}
            disabled={loading || !instructions.trim()}
          >
            Apply to {target?.ids.length ?? 0}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Rewrite the {target?.ids.length ?? 0} selected seed contribution
          {target && target.ids.length === 1 ? '' : 's'} with the instructions below.
          Contributor names, types, and dates are preserved.
        </p>
        <Textarea
          label="Style instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="e.g. no em-dashes, less dramatic, more conversational"
        />
      </div>
    </Modal>
  );
}

interface RowProps {
  contribution: Contribution;
  selected: boolean;
  onToggle: () => void;
  onReview: () => void;
}

function ContributionPreviewRow({ contribution, selected, onToggle, onReview }: RowProps) {
  const preview = previewText(contribution);
  const isPending = contribution.status === 'pending';

  return (
    <li
      className={`flex items-start gap-3 px-4 py-3 transition-colors ${
        selected ? 'bg-amber-50/50' : 'hover:bg-gray-50'
      }`}
    >
      <div className="pt-0.5">
        <Checkbox
          checked={selected}
          onChange={isPending ? onToggle : undefined}
          disabled={!isPending}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900">{contribution.contributor_name}</span>
          {contribution.source === 'studio_seed' && (
            <Badge
              variant="outline"
              size="sm"
              className="text-[10px] text-violet-600 border-violet-300"
            >
              seed
            </Badge>
          )}
          <Badge variant="outline" size="sm">{contribution.type}</Badge>
          <StatusBadge domain="contribution" status={contribution.status} />
          <span className="text-xs text-gray-400">
            {new Date(contribution.created_at).toLocaleDateString()}
          </span>
        </div>
        {preview && (
          <p className="mt-1 line-clamp-2 text-sm text-gray-500">{preview}</p>
        )}
      </div>
      <Button
        variant={isPending ? 'primary' : 'secondary'}
        size="sm"
        onClick={onReview}
      >
        {isPending ? 'Review' : 'View'}
      </Button>
    </li>
  );
}

function previewText(c: Contribution): string {
  if (c.type === 'story') return c.content;
  return c.caption ?? c.content;
}

interface ReviewModalProps {
  contribution: Contribution | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  position: { index: number; total: number } | null;
}

interface RefineHistoryEntry {
  id: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  instructions: string | null;
  scope: 'targeted' | 'all_pending_seeds';
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

function ContributionReviewModal({
  contribution,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  position,
}: ReviewModalProps) {
  const router = useRouter();
  const [adminNotes, setAdminNotes] = useState('');
  const [loading, setLoading] = useState<'approve' | 'reject' | 'reopen' | null>(null);
  const [history, setHistory] = useState<RefineHistoryEntry[]>([]);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInstructions, setRefineInstructions] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [restoringIdx, setRestoringIdx] = useState<number | null>(null);

  useEffect(() => {
    setAdminNotes(contribution?.admin_notes ?? '');
    setLoading(null);
    setRefineOpen(false);
    setRefineInstructions('');
    setRefineLoading(false);
    setHistory([]);

    if (!contribution) return;

    let cancelled = false;
    fetch(`/api/contributions/${contribution.id}/refine-history`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setHistory(data.history ?? []);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [contribution]);

  // Keyboard shortcuts: J/← prev, K/→ next, A approve, R reject, Esc close
  useEffect(() => {
    if (!contribution) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when user is typing
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (hasPrev) onPrev();
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (hasNext) onNext();
      } else if ((e.key === 'a' || e.key === 'A') && contribution.status === 'pending') {
        e.preventDefault();
        handleAction('approve');
      } else if ((e.key === 'r' || e.key === 'R') && contribution.status === 'pending') {
        e.preventDefault();
        handleAction('reject');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contribution, hasPrev, hasNext]);

  const handleRestore = async (versionIndex: number) => {
    if (!contribution) return;
    setRestoringIdx(versionIndex);
    const result = await restoreContributionVersion(contribution.id, versionIndex);
    if (result.success) {
      toast.success('Restored previous version');
      router.refresh();
      onClose();
    } else {
      toast.error(result.error || 'Restore failed');
    }
    setRestoringIdx(null);
  };

  const handleAction = async (action: 'approve' | 'reject' | 'reopen') => {
    if (!contribution) return;
    setLoading(action);
    const fn =
      action === 'approve'
        ? approveContribution
        : action === 'reject'
          ? rejectContribution
          : reopenContribution;
    const result = await fn(contribution.id, adminNotes || undefined);

    if (result.success) {
      const verb =
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reopened';
      toast.success(`Contribution ${verb}`);
      router.refresh();
      // Reopen leaves the modal open so the operator can immediately
      // refine or approve from a clean pending state.
      if (action === 'reopen') setLoading(null);
      else onClose();
    } else {
      toast.error(result.error || 'Something went wrong');
      setLoading(null);
    }
  };

  const handleRefineThis = async () => {
    if (!contribution || !refineInstructions.trim()) return;
    setRefineLoading(true);
    try {
      const res = await fetch(`/api/topics/${contribution.topic_id}/refine-contributions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: refineInstructions.trim(), ids: [contribution.id] }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Refinement failed');
        setRefineLoading(false);
        return;
      }
      toast.success('Queued refinement');
      router.refresh();
      onClose();
    } catch {
      toast.error('Network error');
      setRefineLoading(false);
    }
  };

  const isPending = contribution?.status === 'pending';
  const canRefine = contribution?.source === 'studio_seed' && contribution.status === 'pending';

  return (
    <Modal
      isOpen={contribution !== null}
      onClose={onClose}
      size="lg"
      header={
        contribution ? (
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Contribution review
                {position && (
                  <span className="ml-2 text-gray-400">
                    {position.index} / {position.total}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">
                  {contribution.contributor_name}
                </h2>
                <StatusBadge domain="contribution" status={contribution.status} />
                <Badge variant="outline" size="sm">{contribution.type}</Badge>
                {contribution.source === 'studio_seed' && (
                  <Badge
                    variant="outline"
                    size="sm"
                    className="text-[10px] text-violet-600 border-violet-300"
                  >
                    seed
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onPrev}
                disabled={!hasPrev}
                aria-label="Previous (J)"
                title="Previous (J)"
                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!hasNext}
                aria-label="Next (K)"
                title="Next (K)"
                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                ▶
              </button>
            </div>
          </div>
        ) : null
      }
      actions={
        isPending ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading !== null}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleAction('reject')}
              loading={loading === 'reject'}
              disabled={loading !== null}
            >
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => handleAction('approve')}
              loading={loading === 'approve'}
              disabled={loading !== null}
            >
              Approve
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleAction('reopen')}
              loading={loading === 'reopen'}
              disabled={loading !== null}
            >
              Reopen
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading !== null}>
              Close
            </Button>
          </div>
        )
      }
    >
      {contribution && (
        <div className="space-y-5">
          <section>
            <SectionLabel>Content</SectionLabel>
            <ContentBlock contribution={contribution} />
          </section>

          <section>
            <SectionLabel>Contributor</SectionLabel>
            <FieldList columns={2}>
              <Field label="Email" value={contribution.contributor_email} />
              {contribution.contributor_location && (
                <Field label="Location" value={contribution.contributor_location} />
              )}
              <Field label="Topic" value={contribution.topic_id} />
              <Field
                label="Submitted"
                value={new Date(contribution.created_at).toLocaleString()}
              />
              <Field label="Public" value={contribution.show_publicly ? 'Yes' : 'No'} />
              <Field
                label="Source"
                value={contribution.source === 'studio_seed' ? 'Studio seed' : 'Community'}
              />
            </FieldList>
          </section>

          {canRefine && (
            <section className="rounded-md border border-violet-200 bg-violet-50/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                    Refine this
                  </p>
                  <p className="text-xs text-gray-600">
                    Rewrite this seed in place with style instructions.
                  </p>
                </div>
                {!refineOpen && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRefineOpen(true)}
                  >
                    Refine
                  </Button>
                )}
              </div>
              {refineOpen && (
                <div className="mt-3 space-y-2">
                  <Textarea
                    label="Style instructions"
                    value={refineInstructions}
                    onChange={(e) => setRefineInstructions(e.target.value)}
                    rows={3}
                    placeholder="e.g. swap the broken link for a real one, less poetic"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleRefineThis}
                      loading={refineLoading}
                      disabled={refineLoading || !refineInstructions.trim()}
                    >
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRefineOpen(false);
                        setRefineInstructions('');
                      }}
                      disabled={refineLoading}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          {contribution.previous_versions && contribution.previous_versions.length > 0 && (
            <section>
              <SectionLabel>Previous versions ({contribution.previous_versions.length})</SectionLabel>
              <ul className="space-y-2">
                {contribution.previous_versions.map((v, idx, arr) => {
                  const newerContent =
                    idx === 0 ? contribution.content : arr[idx - 1].content;
                  const newerCaption =
                    idx === 0 ? contribution.caption : arr[idx - 1].caption;
                  return (
                    <li
                      key={`${v.at}-${idx}`}
                      className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900">
                            {new Date(v.at).toLocaleString()}
                          </p>
                          {v.instructions && (
                            <p className="mt-0.5 italic text-gray-600">
                              &ldquo;{v.instructions}&rdquo;
                            </p>
                          )}
                          <VersionDiff
                            version={v}
                            newerContent={newerContent}
                            newerCaption={newerCaption}
                          />
                        </div>
                        {contribution.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRestore(idx)}
                            loading={restoringIdx === idx}
                            disabled={restoringIdx !== null}
                          >
                            Restore
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {history.length > 0 && (
            <section>
              <SectionLabel>Refine history</SectionLabel>
              <ul className="space-y-2">
                {history.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {h.finished_at
                          ? new Date(h.finished_at).toLocaleString()
                          : h.started_at
                            ? `${new Date(h.started_at).toLocaleString()} · running`
                            : 'pending'}
                      </span>
                      <Badge
                        variant={
                          h.status === 'succeeded'
                            ? 'success'
                            : h.status === 'failed'
                              ? 'error'
                              : 'outline'
                        }
                        size="sm"
                      >
                        {h.status}
                      </Badge>
                      {h.scope === 'all_pending_seeds' && (
                        <span className="text-[10px] text-gray-500">
                          (bulk: all pending seeds)
                        </span>
                      )}
                    </div>
                    {h.instructions && (
                      <p className="mt-1 italic text-gray-700">&ldquo;{h.instructions}&rdquo;</p>
                    )}
                    {h.error && (
                      <p className="mt-1 text-red-600">{h.error}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {isPending ? (
            <Textarea
              label="Admin notes (optional)"
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              rows={3}
              placeholder="Add a note about this decision…"
            />
          ) : (
            contribution.admin_notes && (
              <section>
                <SectionLabel>Admin notes</SectionLabel>
                <p className="text-sm text-gray-700">{contribution.admin_notes}</p>
              </section>
            )
          )}
        </div>
      )}
    </Modal>
  );
}

function ContentBlock({ contribution }: { contribution: Contribution }) {
  if (contribution.type === 'story') {
    return (
      <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-800">
        {contribution.content}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {contribution.type === 'photo' && contribution.content.startsWith('http') ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={contribution.content}
          alt="Contribution"
          className="max-h-64 w-full rounded-md object-contain"
        />
      ) : (
        <a
          href={contribution.content}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all rounded-md bg-gray-50 p-3 text-sm text-blue-600 underline"
        >
          {contribution.content}
        </a>
      )}
      {contribution.caption && (
        <p className="text-sm italic text-gray-600">{contribution.caption}</p>
      )}
    </div>
  );
}
