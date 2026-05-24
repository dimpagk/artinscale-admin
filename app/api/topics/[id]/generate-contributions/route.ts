import { NextResponse } from 'next/server';
import { getTopic } from '@/lib/topics';
import { generateContributions } from '@/lib/contribution-generator';
import { startAgentTask, finishAgentTask } from '@/lib/agents/base';
import { checkContributionConcurrency } from '@/lib/agents/concurrency';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let count: number;
  let instructions: string | undefined;
  try {
    const body = await request.json();
    count = Number(body.count);
    if (!count || count < 1 || count > 50) {
      return NextResponse.json(
        { error: 'count must be between 1 and 50' },
        { status: 400 }
      );
    }
    if (typeof body.instructions === 'string' && body.instructions.trim()) {
      instructions = body.instructions.trim();
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
    agentName: 'contribution-generator',
    triggerKind: 'manual',
    input: { topic_id: id, count, instructions: instructions ?? null },
  });

  if (!task) {
    return NextResponse.json({ error: 'Failed to start task' }, { status: 500 });
  }

  // Fire-and-forget: don't block the HTTP response on the AI call
  void generateContributions(topic, count, instructions, task.id)
    .then((result) => {
      if (result.error) {
        return finishAgentTask(task.id, { status: 'failed', error: result.error });
      }
      return finishAgentTask(task.id, {
        status: 'succeeded',
        output: {
          created: result.created,
          ...(result.imageFailures ? { image_failures: result.imageFailures } : {}),
        },
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
