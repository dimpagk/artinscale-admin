import { NextResponse } from 'next/server';
import { getTopic } from '@/lib/topics';
import { refinePendingSeedContributions } from '@/lib/contribution-generator';
import { startAgentTask, finishAgentTask } from '@/lib/agents/base';
import { checkContributionConcurrency } from '@/lib/agents/concurrency';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let instructions: string;
  let ids: string[] | undefined;
  try {
    const body = await request.json();
    instructions = String(body.instructions ?? '').trim();
    if (!instructions) {
      return NextResponse.json(
        { error: 'instructions is required' },
        { status: 400 }
      );
    }
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      ids = body.ids.filter((v: unknown): v is string => typeof v === 'string');
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const topic = await getTopic(id);
  if (!topic) {
    return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
  }

  const guard = await checkContributionConcurrency(id);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.message, running: guard.running, limit: guard.limit },
      { status: 429 }
    );
  }

  const task = await startAgentTask({
    agentName: 'contribution-refiner',
    triggerKind: 'manual',
    input: {
      topic_id: id,
      instructions,
      ids: ids ?? null,
      target_count: ids?.length ?? null,
    },
  });

  if (!task) {
    return NextResponse.json({ error: 'Failed to start task' }, { status: 500 });
  }

  void refinePendingSeedContributions(topic, instructions, ids, task.id)
    .then((result) => {
      if (result.error) {
        return finishAgentTask(task.id, { status: 'failed', error: result.error });
      }
      return finishAgentTask(task.id, {
        status: 'succeeded',
        output: { updated: result.updated },
      });
    })
    .catch((err) =>
      finishAgentTask(task.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    );

  return NextResponse.json({ task_id: task.id, status: 'running' }, { status: 202 });
}
