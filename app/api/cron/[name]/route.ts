import { NextResponse } from 'next/server'
import { runTopicIdeator } from '@/lib/agents/topic-ideator'
import { runContributionModerator } from '@/lib/agents/contribution-moderator'
import { runInsightAgent } from '@/lib/agents/insight-agent'
import { runPostingWorker } from '@/lib/publishers/posting-worker'
import { runTopicStatusUpdater } from '@/lib/topic-status-updater'
import { runOrderSync } from '@/lib/orders'
import { reconcilePendingListings } from '@/lib/post-create-publisher'
import { runMockupComposeWorker } from '@/lib/mockup-compose-worker'

// finalize_listings awaits mockup generation (~1-2 min of Gemini calls per
// artwork), so the default ~15s serverless budget kills it mid-run. Raise
// to the Vercel Pro ceiling; the reconcile self-limits how many it touches.
export const maxDuration = 300

/**
 * GET-callable scheduled triggers.
 *
 * Designed for any cron service — Vercel Cron, GitHub Actions, Inngest
 * scheduled functions, or curl from a server. Each route is idempotent
 * via the underlying agent's `startAgentTask` trigger_key, so duplicate
 * scheduled invocations within the same window are safe.
 *
 * Recommended Vercel Cron config (vercel.json):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/topic_ideator", "schedule": "0 9 * * 1" },
 *       { "path": "/api/cron/contribution_moderator", "schedule": "0 * * * *" },
 *       { "path": "/api/cron/insight_agent", "schedule": "0 9 * * 1" },
 *       { "path": "/api/cron/posting_worker", "schedule": "* * * * *" },
 *       { "path": "/api/cron/topic_status_updater", "schedule": "0 *\/6 * * *" }
 *     ]
 *   }
 *
 * Auth: same `AGENT_TRIGGER_TOKEN` as /api/agents/run, OR Vercel's
 * built-in `x-vercel-cron-signature` header (no token needed when
 * called by Vercel's own scheduler).
 */

const AGENT_TRIGGER_TOKEN = process.env.AGENT_TRIGGER_TOKEN

function checkAuth(request: Request): NextResponse | null {
  // Vercel Cron sends a special header when calling cron functions
  if (request.headers.get('x-vercel-cron-signature')) return null

  if (!AGENT_TRIGGER_TOKEN) {
    const url = new URL(request.url)
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0'
    ) {
      return null
    }
    return NextResponse.json(
      { error: 'AGENT_TRIGGER_TOKEN must be configured.' },
      { status: 503 }
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${AGENT_TRIGGER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const authError = checkAuth(request)
  if (authError) return authError

  const { name } = await params
  try {
    const result = await runScheduled(name)
    return NextResponse.json({ ok: true, agent: name, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, agent: name, error: message }, { status: 500 })
  }
}

async function runScheduled(name: string): Promise<unknown> {
  switch (name) {
    case 'topic_ideator':
      return runTopicIdeator({ triggerKind: 'cron' })
    case 'contribution_moderator':
      return runContributionModerator({ triggerKind: 'cron' })
    case 'insight_agent':
      return runInsightAgent({ triggerKind: 'cron' })
    case 'posting_worker':
      return runPostingWorker()
    case 'topic_status_updater':
      return runTopicStatusUpdater()
    case 'order_sync':
      return runOrderSync()
    case 'finalize_listings':
      // Complete the Shopify listing (price, metafields, all channels,
      // mockups, status→listed) for artworks Gelato has finished
      // publishing. The reliable replacement for the fire-and-forget
      // auto-publisher.
      return reconcilePendingListings()
    case 'mockup_worker':
      // Drain the mockup-composer queue: claim queued compose tasks (from
      // the "Generate mockups" button) and run each to completion here,
      // where the maxDuration budget actually covers the work. The
      // reliable replacement for the fire-and-forget compose route.
      return runMockupComposeWorker()
    default:
      throw new Error(`Unknown scheduled job: ${name}`)
  }
}
