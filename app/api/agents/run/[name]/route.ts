import { NextResponse } from 'next/server'
import { runDropCampaignDrafter } from '@/lib/agents/drop-campaign-drafter'
import { runTopicIdeator } from '@/lib/agents/topic-ideator'
import { runCommentReplyDrafter } from '@/lib/agents/comment-reply-drafter'
import { runContributionModerator } from '@/lib/agents/contribution-moderator'
import { runInsightAgent } from '@/lib/agents/insight-agent'
import {
  draftWelcomeEmail,
  draftAbandonedCartEmail,
  draftDropAnnouncementEmail,
  draftWeeklyDigestEmail,
} from '@/lib/agents/email-drafter'
import { runPostingWorker } from '@/lib/publishers/posting-worker'
import { pushArtworkMockupsToShopify } from '@/lib/mockup-publisher'
import { generateListingMeta } from '@/lib/agents/listing-generator'
import { syncArtworkToShopify } from '@/lib/listing-sync'
import { generateContributions } from '@/lib/contribution-generator'
import { getTopic } from '@/lib/topics'
import { startAgentTask } from '@/lib/agents/base'
import { runSoldOutFollowUp } from '@/lib/agents/sold-out-follow-up'
import { ensureUpscaledForArtworkImage, runUpscaleForGeneratedImage } from '@/lib/upscale-runner'
import { autoPublishArtworkAfterGelatoCreate } from '@/lib/post-create-publisher'

/**
 * Manual trigger endpoint for any agent or worker.
 *
 * POST /api/agents/run/{name}    body: agent-specific input JSON
 *
 * Names:
 *   - drop_campaign_drafter           { artworkId }
 *   - topic_ideator                   {}
 *   - comment_reply_drafter           { threadId }
 *   - contribution_moderator          { topicId? }
 *   - insight_agent                   {}
 *   - email_welcome                   { to, firstName?, storefrontUrl }
 *   - email_abandoned_cart            { to, firstName?, productTitle, productUrl, imageUrl? }
 *   - email_drop_announcement         { to, artworkId, storefrontUrl }
 *   - email_weekly_digest             { to, storefrontUrl }
 *   - posting_worker                  {}  (publishes due social posts)
 *
 * Auth: gated by an admin-only Bearer token, verified via env.
 *
 * The same handler is reachable via /api/cron/{name} for scheduled
 * triggers — see the cron route for the GET variant.
 */

const AGENT_TRIGGER_TOKEN = process.env.AGENT_TRIGGER_TOKEN

function checkAuth(request: Request): NextResponse | null {
  if (!AGENT_TRIGGER_TOKEN) {
    // If the operator hasn't set a token, only allow from localhost
    const url = new URL(request.url)
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0'
    ) {
      return null
    }
    return NextResponse.json(
      { error: 'AGENT_TRIGGER_TOKEN must be configured to call this endpoint over the network.' },
      { status: 503 }
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${AGENT_TRIGGER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const authError = checkAuth(request)
  if (authError) return authError

  const { name } = await params
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  try {
    const result = await dispatch(name, body)
    return NextResponse.json({ ok: true, agent: name, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { ok: false, agent: name, error: message },
      { status: 500 }
    )
  }
}

async function dispatch(name: string, body: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'drop_campaign_drafter':
      return runDropCampaignDrafter({ artworkId: requireString(body, 'artworkId'), triggerKind: 'manual' })
    case 'topic_ideator':
      return runTopicIdeator({ triggerKind: 'manual', triggerKey: typeof body.triggerKey === 'string' ? body.triggerKey : undefined })
    case 'comment_reply_drafter':
      return runCommentReplyDrafter({ threadId: requireString(body, 'threadId'), triggerKind: 'manual' })
    case 'contribution_moderator':
      return runContributionModerator({
        topicId: typeof body.topicId === 'string' ? body.topicId : undefined,
        triggerKind: 'manual',
      })
    case 'insight_agent':
      return runInsightAgent({ triggerKind: 'manual' })
    case 'email_welcome':
      return draftWelcomeEmail({
        to: requireString(body, 'to'),
        firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
        storefrontUrl: requireString(body, 'storefrontUrl'),
      })
    case 'email_abandoned_cart':
      return draftAbandonedCartEmail({
        to: requireString(body, 'to'),
        firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
        productTitle: requireString(body, 'productTitle'),
        productUrl: requireString(body, 'productUrl'),
        imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : undefined,
      })
    case 'email_drop_announcement':
      return draftDropAnnouncementEmail({
        to: requireRecipients(body, 'to'),
        artworkId: requireString(body, 'artworkId'),
        storefrontUrl: requireString(body, 'storefrontUrl'),
      })
    case 'email_weekly_digest':
      return draftWeeklyDigestEmail({
        to: requireRecipients(body, 'to'),
        storefrontUrl: requireString(body, 'storefrontUrl'),
      })
    case 'posting_worker':
      return runPostingWorker()
    case 'mockup_publisher':
      // Compose 6-image mockup set for an artwork and push it onto its
      // Shopify product (replacing Gelato's auto-generated default).
      // Idempotent — re-running uses cached storage entries.
      return pushArtworkMockupsToShopify(requireString(body, 'artworkId'))
    case 'listing_generator':
      // Generate SEO + social copy for an artwork's listing_meta. Pass
      // `force: true` to overwrite existing meta (e.g. after a title
      // change). Default behavior is idempotent — skips when meta is
      // already populated.
      return generateListingMeta({
        artworkId: requireString(body, 'artworkId'),
        force: body.force === true,
      })
    case 'listing_sync':
      // Push the artwork's canonical state (vendor, price, tags,
      // status, SEO metafields, inventory, collections) to Shopify
      // and Gelato. Use `regenerate: true` to also re-run the
      // listing-generator first; default skips the agent for fast
      // data-only syncs.
      return syncArtworkToShopify(requireString(body, 'artworkId'), {
        regenerate: body.regenerate === true,
        skipAgent: body.skipAgent === true,
      })
    case 'upscaler':
      // Upscale a generated_images row OR an artwork's image_url.
      // Pass either `generatedImageId` (direct) or `imageUrl` (we'll
      // look up the matching generated_images row). Idempotent.
      if (typeof body.generatedImageId === 'string') {
        return runUpscaleForGeneratedImage({
          generatedImageId: body.generatedImageId,
          scale: body.scale === 2 ? 2 : 4,
        })
      }
      return ensureUpscaledForArtworkImage(requireString(body, 'imageUrl'))
    case 'sold_out_follow_up':
      // Draft a successor-piece proposal into the approval queue.
      // Fires automatically when an artwork transitions to sold-out
      // (via updateArtworkAction); this route is for manual re-runs.
      return runSoldOutFollowUp({ artworkId: requireString(body, 'artworkId') })
    case 'contribution_generator': {
      // Seed contributions for a topic via the studio_seed source.
      // Used by the operator to backfill sparse topics before
      // clustering / generation. The session-gated UI endpoint
      // (/api/topics/{id}/generate-contributions) calls the same lib
      // function — this Bearer-gated path is the cross-app
      // equivalent.
      const topicId = requireString(body, 'topicId')
      const count = typeof body.count === 'number' ? body.count : 15
      const instructions = typeof body.instructions === 'string' ? body.instructions : undefined
      const topic = await getTopic(topicId)
      if (!topic) throw new Error(`Topic not found: ${topicId}`)
      const task = await startAgentTask({
        agentName: 'contribution-generator',
        triggerKind: 'manual',
        input: { topic_id: topicId, count, instructions: instructions ?? null },
      })
      if (!task) {
        return { skipped: 'already_running', topicId, count }
      }
      const result = await generateContributions(topic, count, instructions, task.id)
      return { topicId, count, result }
    }
    case 'auto_publisher':
      // Resume the post-Gelato-create chain manually — useful when
      // the original auto-publisher poll timed out (e.g. Shopify auto-
      // publish was delayed beyond the 60s window). Idempotent on
      // already-published artworks.
      return autoPublishArtworkAfterGelatoCreate({
        artworkId: requireString(body, 'artworkId'),
        pollTimeoutMs: typeof body.pollTimeoutMs === 'number' ? body.pollTimeoutMs : undefined,
      })
    default:
      throw new Error(`Unknown agent: ${name}`)
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key]
  if (typeof v !== 'string' || !v) throw new Error(`Body field "${key}" is required (string).`)
  return v
}

function requireRecipients(body: Record<string, unknown>, key: string): string | string[] {
  const v = body[key]
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[]
  throw new Error(`Body field "${key}" is required (string | string[]).`)
}
