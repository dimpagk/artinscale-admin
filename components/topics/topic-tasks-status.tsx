'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Spinner } from '@phosphor-icons/react';
import { createClient } from '@/lib/supabase/client';

interface AgentTaskRow {
  id: string;
  agent_name: 'contribution-generator' | 'contribution-refiner' | string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface TopicTasksStatusProps {
  topicId: string;
}

const POLL_INTERVAL_MS = 2500;
const SUPPORTED_AGENTS = ['contribution-generator', 'contribution-refiner'];

export function TopicTasksStatus({ topicId }: TopicTasksStatusProps) {
  const router = useRouter();
  const [running, setRunning] = useState<AgentTaskRow[]>([]);
  const seenDoneIds = useRef<Set<string>>(new Set());

  // Initial seed via REST. Then realtime updates via Supabase channel.
  // Polling stays as a safety-net fallback (every POLL_INTERVAL_MS) in
  // case realtime drops a message — cheap because the endpoint only
  // returns the last 5 minutes of tasks.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleTask = (task: AgentTaskRow, isDelta: boolean) => {
      if (!task) return;
      if (!SUPPORTED_AGENTS.includes(task.agent_name)) return;
      const taskTopicId = (task.input as { topic_id?: string } | null)?.topic_id;
      if (taskTopicId !== topicId) return;

      if (task.status === 'running') {
        setRunning((prev) => {
          const without = prev.filter((t) => t.id !== task.id);
          return [...without, task].sort(
            (a, b) =>
              new Date(a.started_at ?? 0).getTime() -
              new Date(b.started_at ?? 0).getTime()
          );
        });
      } else {
        setRunning((prev) => prev.filter((t) => t.id !== task.id));
        // Toast and refresh on transition
        if (isDelta && !seenDoneIds.current.has(task.id)) {
          seenDoneIds.current.add(task.id);
          if (task.status === 'succeeded') {
            toast.success(describeSuccess(task));
            router.refresh();
          } else if (task.status === 'failed') {
            toast.error(`${describeAgent(task.agent_name)}: ${task.error_message || 'failed'}`);
          }
        }
      }
    };

    let isFirstPoll = true;

    const seed = async () => {
      try {
        const res = await fetch(
          `/api/agent-tasks?topic_id=${encodeURIComponent(topicId)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) {
          timer = setTimeout(seed, POLL_INTERVAL_MS * 2);
          return;
        }
        const data: { running: AgentTaskRow[]; recentlyDone: AgentTaskRow[] } = await res.json();
        if (cancelled) return;

        // The server's `running` list is authoritative — replace local
        // state wholesale so spinners clear even if a realtime delta was
        // dropped (tab backgrounded, channel reconnect, etc.)
        const validRunning = data.running
          .filter((t) => SUPPORTED_AGENTS.includes(t.agent_name))
          .filter(
            (t) => (t.input as { topic_id?: string } | null)?.topic_id === topicId
          )
          .sort(
            (a, b) =>
              new Date(a.started_at ?? 0).getTime() -
              new Date(b.started_at ?? 0).getTime()
          );
        setRunning(validRunning);

        // Toast newly-finished tasks. On the first poll we just mark
        // them seen without toasting — they completed before this mount.
        for (const task of data.recentlyDone) {
          if (!SUPPORTED_AGENTS.includes(task.agent_name)) continue;
          const taskTopicId = (task.input as { topic_id?: string } | null)?.topic_id;
          if (taskTopicId !== topicId) continue;
          if (seenDoneIds.current.has(task.id)) continue;
          seenDoneIds.current.add(task.id);
          if (isFirstPoll) continue;
          if (task.status === 'succeeded') {
            toast.success(describeSuccess(task));
            router.refresh();
          } else if (task.status === 'failed') {
            toast.error(
              `${describeAgent(task.agent_name)}: ${task.error_message || 'failed'}`
            );
          }
        }

        isFirstPoll = false;
        timer = setTimeout(seed, POLL_INTERVAL_MS);
      } catch {
        timer = setTimeout(seed, POLL_INTERVAL_MS * 2);
      }
    };

    // Realtime subscription
    const supabase = createClient();
    const channel = supabase
      .channel(`agent-tasks-topic-${topicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_tasks' },
        (payload) => {
          const row = (payload.new ?? payload.old) as AgentTaskRow;
          handleTask(row, true);
        }
      )
      .subscribe();

    seed();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [topicId, router]);

  if (running.length === 0) return null;

  return (
    <div className="space-y-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
      {running.map((task) => (
        <div key={task.id} className="flex items-center gap-2 text-xs text-blue-900">
          <Spinner size={12} weight="bold" className="shrink-0 animate-spin" />
          <span className="font-medium">{describeRunning(task)}</span>
        </div>
      ))}
    </div>
  );
}

function describeAgent(agent: string): string {
  if (agent === 'contribution-generator') return 'Generation';
  if (agent === 'contribution-refiner') return 'Refinement';
  return agent;
}

function describeRunning(task: AgentTaskRow): string {
  const input = task.input as { count?: number; target_count?: number | null } | null;
  const out = task.output as
    | { phase?: string; progress?: number; target?: number }
    | null;

  // Progress display: e.g. "Generating 12/20 (inserting)"
  if (out?.target != null && typeof out.progress === 'number') {
    const phase = out.phase ? ` · ${out.phase}` : '';
    if (task.agent_name === 'contribution-generator') {
      return `Generating ${out.progress}/${out.target}${phase}…`;
    }
    if (task.agent_name === 'contribution-refiner') {
      return `Refining ${out.progress}/${out.target}${phase}…`;
    }
  }

  // Initial label before any progress is reported
  if (task.agent_name === 'contribution-generator') {
    return `Generating ${input?.count ?? '?'} contributions…`;
  }
  if (task.agent_name === 'contribution-refiner') {
    return input?.target_count
      ? `Refining ${input.target_count} contributions…`
      : 'Refining all pending seeds…';
  }
  return `${describeAgent(task.agent_name)} running…`;
}

function describeSuccess(task: AgentTaskRow): string {
  const out = task.output as { created?: number; updated?: number } | null;
  if (task.agent_name === 'contribution-generator' && out?.created != null) {
    return `Generated ${out.created} contributions`;
  }
  if (task.agent_name === 'contribution-refiner' && out?.updated != null) {
    return `Refined ${out.updated} contributions`;
  }
  return `${describeAgent(task.agent_name)} done`;
}
