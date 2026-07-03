/**
 * Mockup-compose queue + worker.
 *
 * Durable replacement for the old fire-and-forget compose. The
 * "Generate mockups" route used to kick off `composeArtworkMockups` as a
 * detached promise and return 202 immediately; on Vercel the serverless
 * instance is frozen the moment the response is sent, so the compose was
 * killed mid-run and the reaper later marked the orphaned task "failed"
 * ("worker likely restarted mid-run").
 *
 * Instead the route now only ENQUEUES a task (status='queued'), and the
 * `mockup_worker` cron (see app/api/cron/[name]/route.ts) claims queued
 * tasks and runs each compose to completion inside the cron's
 * maxDuration. Same pattern the reconcile cron uses for the post-Gelato
 * listing chain.
 *
 *   enqueueMockupCompose:  de-dupes + inserts a queued task (fast; called
 *                          from the POST route).
 *   runMockupComposeWorker: claims and processes queued tasks (called by
 *                           the cron every minute).
 */

import { getArtworkById } from './artworks';
import { composeArtworkMockups } from './mockup-composer';
import { mockupSetToShopifyOrder } from './mockup-publisher';
import { replaceShopifyProductImages } from './shopify-admin';
import {
  enqueueAgentTask,
  findActiveAgentTask,
  claimNextAgentTask,
  finishAgentTask,
} from './agents/base';

export const MOCKUP_COMPOSER_AGENT = 'mockup-composer';

/**
 * Queue a compose for an artwork. De-dupes on the artwork correlation id:
 * if a compose is already queued or running for this piece, that task is
 * returned instead of stacking a second one (so a double-click is a
 * no-op). A finished (succeeded/failed) prior run does not block, so
 * "Regenerate mockups" always enqueues a fresh task.
 */
export async function enqueueMockupCompose(args: {
  artworkId: string;
  force?: boolean;
  aestheticHint?: string;
}): Promise<{ taskId: string; status: 'queued' | 'running'; deduped: boolean }> {
  const correlationId = `artwork:${args.artworkId}`;

  const existing = await findActiveAgentTask({
    agentName: MOCKUP_COMPOSER_AGENT,
    correlationId,
  });
  if (existing) {
    return { taskId: existing.id, status: existing.status, deduped: true };
  }

  const task = await enqueueAgentTask({
    agentName: MOCKUP_COMPOSER_AGENT,
    triggerKind: 'manual',
    correlationId,
    input: {
      artwork_id: args.artworkId,
      force: args.force === true,
      aesthetic_hint: args.aestheticHint ?? null,
    },
  });
  if (!task) {
    // Lost a de-dupe race (another request enqueued between our check and
    // insert). Re-read the active task rather than erroring.
    const raced = await findActiveAgentTask({
      agentName: MOCKUP_COMPOSER_AGENT,
      correlationId,
    });
    if (raced) return { taskId: raced.id, status: raced.status, deduped: true };
    throw new Error('Failed to enqueue mockup compose');
  }

  return { taskId: task.id, status: 'queued', deduped: false };
}

/**
 * Run one claimed compose task end-to-end: compose the 5-shot set, push
 * it onto the Shopify gallery if the artwork is already listed, and mark
 * the task terminal. Never throws; any failure is recorded on the task.
 */
async function processComposeTask(
  taskId: string,
  input: Record<string, unknown>
): Promise<{ taskId: string; status: 'succeeded' | 'failed'; error?: string }> {
  const artworkId = typeof input.artwork_id === 'string' ? input.artwork_id : '';
  const force = input.force === true;
  const aestheticHint =
    typeof input.aesthetic_hint === 'string' ? input.aesthetic_hint : undefined;

  try {
    if (!artworkId) throw new Error('Task input missing artwork_id');

    const artwork = await getArtworkById(artworkId);
    if (!artwork) throw new Error('Artwork not found');
    if (!artwork.image_url) throw new Error('Artwork has no image_url');
    if (!artwork.product_type) {
      throw new Error('Artwork has no product_type; set the size first');
    }

    const result = await composeArtworkMockups({
      artworkId,
      sourceImageUrl: artwork.image_url,
      productType: artwork.product_type,
      aestheticHint: aestheticHint as never,
      force,
    });

    // If the artwork is already listed on Shopify, push the composed set
    // onto the product's image gallery (moved here from the old POST
    // route). Display order comes from mockupSetToShopifyOrder so this
    // stays in lockstep with lib/mockup-publisher.ts. Failures are
    // non-fatal; recorded in task output, the operator can retry.
    let shopifyResult: { uploaded: number; deleted: number } | null = null;
    let shopifyError: string | null = null;
    if (artwork.shopify_handle && result.imageUrls) {
      try {
        const orderedImages = mockupSetToShopifyOrder(result.imageUrls, artwork.title);
        const uploadRes = await replaceShopifyProductImages({
          shopifyHandle: artwork.shopify_handle,
          images: orderedImages,
        });
        if (uploadRes.ok) {
          shopifyResult = uploadRes.data ?? null;
        } else {
          shopifyError = uploadRes.error ?? 'unknown';
        }
      } catch (err) {
        shopifyError = err instanceof Error ? err.message : String(err);
      }
    }

    await finishAgentTask(taskId, {
      status: 'succeeded',
      output: {
        image_urls: result.imageUrls,
        generated: result.generated,
        errors: result.errors,
        shopify: shopifyResult ? { ...shopifyResult } : null,
        shopify_error: shopifyError,
      },
    });
    return { taskId, status: 'succeeded' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishAgentTask(taskId, { status: 'failed', error: message });
    return { taskId, status: 'failed', error: message };
  }
}

/**
 * Cron worker: claim and process queued mockup-composer tasks.
 *
 * Each compose is ~100s of Gemini calls, so the batch is kept small
 * enough to finish inside the cron's maxDuration (300s); any backlog
 * drains across successive minute-by-minute runs. Tasks are claimed
 * atomically, so overlapping cron invocations never double-process one.
 */
export async function runMockupComposeWorker(
  opts: { limit?: number } = {}
): Promise<{
  claimed: number;
  results: Array<{ taskId: string; status: string; error?: string }>;
}> {
  const limit = opts.limit ?? 2;
  const results: Array<{ taskId: string; status: string; error?: string }> = [];

  for (let i = 0; i < limit; i++) {
    const task = await claimNextAgentTask(MOCKUP_COMPOSER_AGENT);
    if (!task) break; // queue empty
    const r = await processComposeTask(task.id, task.input);
    results.push(r);
  }

  return { claimed: results.length, results };
}
