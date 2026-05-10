'use client';

import { useEffect, useState } from 'react';
import { FormCard } from '@/components/admin-ui';

interface AgentTaskRow {
  id: string;
  agent_name: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  output: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface ApiResponse {
  correlationId: string;
  running: AgentTaskRow[];
  completed: AgentTaskRow[];
  total: number;
}

const POLL_INTERVAL_MS = 3000;

/**
 * Pipeline activity card on the artwork edit page.
 *
 * Polls `/api/agent-tasks/by-correlation?correlation_id=artwork:<id>`
 * every 3s while a task is running, and pauses polling when nothing is
 * running. Shows the last 10 tasks for this artwork (auto-publisher,
 * mockup-publisher, sold-out-notice, etc.) so the operator sees the
 * post-push chain progress in one place instead of hunting the global
 * feed.
 */
export function ArtworkPipelineActivity({ artworkId }: { artworkId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch(
          `/api/agent-tasks/by-correlation?correlation_id=artwork:${artworkId}&limit=10`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setData(json);
        setLoading(false);
        const hasRunning = json.running.length > 0;
        // Tighter polling while something is in flight; longer cadence
        // when idle so we still pick up new pushes without burning
        // requests on a stable view.
        const next = hasRunning ? POLL_INTERVAL_MS : 30_000;
        timer = setTimeout(fetchOnce, next);
      } catch {
        timer = setTimeout(fetchOnce, 10_000);
      }
    }

    fetchOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [artworkId]);

  if (loading && !data) {
    return null;
  }
  if (!data || data.total === 0) {
    return null;
  }

  const all = [...data.running, ...data.completed];

  return (
    <FormCard
      className="mt-6"
      title="Pipeline activity"
      description="Background tasks triggered for this artwork (auto-publisher, mockups, sold-out notices). Polls every 3s while anything is running."
    >
      <div className="space-y-2">
        {all.map((task) => (
          <PipelineRow key={task.id} task={task} />
        ))}
      </div>
    </FormCard>
  );
}

function PipelineRow({ task }: { task: AgentTaskRow }) {
  const started = task.started_at ? new Date(task.started_at) : null;
  const finished = task.finished_at ? new Date(task.finished_at) : null;
  const durationMs = started && finished ? finished.getTime() - started.getTime() : null;
  const dot = STATUS_DOT[task.status];

  return (
    <div className="flex items-start gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm">
      <span
        className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-xs">{task.agent_name}</span>
          <span className="text-xs text-zinc-500">
            {started?.toLocaleTimeString() ?? ''}
            {durationMs != null && ` · ${formatDuration(durationMs)}`}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-zinc-600 truncate">{summarize(task)}</div>
      </div>
    </div>
  );
}

const STATUS_DOT: Record<AgentTaskRow['status'], string> = {
  running: 'bg-blue-500 animate-pulse',
  succeeded: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-zinc-400',
};

function summarize(task: AgentTaskRow): string {
  if (task.status === 'failed') return task.error_message ?? 'Failed';
  if (task.status === 'running') return 'In progress';
  // Succeeded — pull a useful one-liner from the output shape
  const out = task.output ?? {};
  if (typeof out.message === 'string') return out.message;
  if (typeof out.shopify_handle === 'string') return `published → ${out.shopify_handle}`;
  if (typeof (out as { applied?: { shopifyHandle?: string } }).applied?.shopifyHandle === 'string') {
    return `published → ${(out as { applied: { shopifyHandle: string } }).applied.shopifyHandle}`;
  }
  if (typeof out.uploaded === 'number' && typeof out.deleted === 'number') {
    return `${out.uploaded} images uploaded, ${out.deleted} replaced`;
  }
  if (typeof out.upscaledImageUrl === 'string') return 'upscaled';
  return 'Done';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}
