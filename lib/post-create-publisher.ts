/**
 * Post-create publisher.
 *
 * Closes the loop after `pushToGelatoAction` so the operator no longer
 * has to manually paste the Shopify handle. Gelato auto-publishes new
 * products to the connected Shopify store ~15 seconds after the
 * `:create-from-template` POST returns; this module polls until that
 * publish lands, grabs the handle from the Gelato product GET, then
 * fires the same chain of side-effects that the manual
 * `markArtworkAsListedAction` does.
 *
 * Pieces:
 *   - `pollGelatoUntilPublished` — poll the Gelato product GET until
 *     handle is non-null OR a deadline elapses.
 *   - `applyListedState` — the shared "we know the handle, do all the
 *     listing-time effects" function. Used by both the manual and the
 *     auto path so they stay in lock-step.
 *   - `autoPublishArtworkAfterGelatoCreate` — orchestrator: poll →
 *     lookup Shopify → applyListedState.
 *
 * All three are idempotent. Re-running on an already-listed artwork
 * is a no-op for the persistent state and a soft-update for the
 * Shopify-side fields (which the listing-sync handles per-step).
 */

import { supabaseAdmin } from './supabase/admin';
import {
  getShopifyProductByHandle,
} from './shopify-admin';
import { syncArtworkToShopify } from './listing-sync';
import { pushArtworkMockupsToShopify } from './mockup-publisher';
import { startAgentTask, finishAgentTask } from './agents/base';
import { runDropCampaignDrafter } from './agents/drop-campaign-drafter';
import { linkProductToTopic, getArtworkById, updateArtwork } from './artworks';

const GELATO_API_KEY = process.env.GELATO_API_KEY;
const GELATO_STORE_ID = process.env.GELATO_STORE_ID;
const GELATO_DRY_RUN = process.env.GELATO_DRY_RUN === 'true';
const GELATO_ECOMMERCE_API_BASE = 'https://ecommerce.gelatoapis.com/v1';

export interface GelatoPublishedSummary {
  productId: string;
  handle: string;
  status: string;
  variantCount: number;
}

/**
 * Poll the Gelato product GET endpoint until the auto-publish to
 * Shopify completes (signaled by `handle` becoming non-null).
 *
 * Returns null when the deadline passes — the caller can decide
 * whether to surface a warning or retry later. Common case: takes
 * 12–18 seconds end-to-end.
 */
export async function pollGelatoUntilPublished(
  productId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<GelatoPublishedSummary | null> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const deadline = Date.now() + timeoutMs;

  if (GELATO_DRY_RUN) {
    console.log('[post-create-publisher] DRY RUN — pollGelatoUntilPublished', { productId });
    return null;
  }
  if (!GELATO_API_KEY || !GELATO_STORE_ID) {
    throw new Error('Gelato credentials missing');
  }

  while (Date.now() < deadline) {
    const res = await fetch(
      `${GELATO_ECOMMERCE_API_BASE}/stores/${GELATO_STORE_ID}/products/${productId}`,
      { headers: { 'X-API-KEY': GELATO_API_KEY } }
    );
    if (res.ok) {
      const body = (await res.json()) as {
        id?: string;
        handle?: string | null;
        status?: string;
        variants?: unknown[];
      };
      if (body.handle && body.status === 'active') {
        return {
          productId: body.id ?? productId,
          handle: body.handle,
          status: body.status,
          variantCount: Array.isArray(body.variants) ? body.variants.length : 0,
        };
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return null;
}

export interface ApplyListedStateResult {
  artworkId: string;
  shopifyHandle: string;
  shopifyProductId: string | null;
  syncWarnings: string[];
  mockupTaskId: string | null;
  dropCampaignError: string | null;
}

/**
 * Shared "the artwork is now listed" effect:
 *   1. Persist shopify_handle / shopify_product_id / status='listed'
 *   2. linkProductToTopic for the storefront's "Story Behind This
 *      Artwork" block
 *   3. Run the full listing-sync (vendor, price, tags, body_html,
 *      metafields, inventory, collections — runs the listing-generator
 *      agent if listing_meta is empty)
 *   4. Fire the mockup pipeline in the background via agent_tasks
 *   5. Fire the drop campaign drafter (non-fatal if it errors)
 *
 * Steps 4 and 5 are background-fire-and-forget so callers don't block
 * on slow image processing or agent calls. Step 3 is synchronous —
 * the operator should see the up-to-date Shopify product when the
 * action returns.
 */
export async function applyListedState(args: {
  artworkId: string;
  shopifyHandle: string;
  shopifyProductId: string | null;
  triggerKind?: 'manual' | 'event';
}): Promise<ApplyListedStateResult> {
  const { artworkId, shopifyHandle, shopifyProductId } = args;

  const artwork = await getArtworkById(artworkId);
  if (!artwork) throw new Error('Artwork not found');

  await updateArtwork(artworkId, {
    shopify_handle: shopifyHandle,
    shopify_product_id: shopifyProductId,
    status: 'listed',
  });

  if (artwork.topic_id) {
    await linkProductToTopic(shopifyHandle, artwork.topic_id);
  }

  // Full sync. Runs the listing-generator agent for first-time listings
  // (the agent skips itself if listing_meta is already populated).
  const sync = await syncArtworkToShopify(artworkId, { skipAgent: false });
  if (sync.warnings.length > 0) {
    console.warn(`[post-create-publisher] sync warnings for ${shopifyHandle}:`, sync.warnings);
  }

  // Fire mockup pipeline in background
  let mockupTaskId: string | null = null;
  try {
    const task = await startAgentTask({
      agentName: 'mockup-publisher',
      triggerKind: args.triggerKind ?? 'event',
      correlationId: `artwork:${artworkId}`,
      input: { artwork_id: artworkId, shopify_handle: shopifyHandle },
    });
    if (task) {
      mockupTaskId = task.id;
      void pushArtworkMockupsToShopify(artworkId)
        .then((result) =>
          finishAgentTask(task.id, {
            status: result.ok ? 'succeeded' : 'failed',
            output: result.ok ? (result.data as unknown as Record<string, unknown>) : undefined,
            error: result.ok ? undefined : result.error,
          })
        )
        .catch((err) =>
          finishAgentTask(task.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
        );
    }
  } catch (err) {
    console.error('mockup publisher trigger failed (non-fatal):', err);
  }

  // Fire drop campaign drafter (non-fatal)
  let dropCampaignError: string | null = null;
  try {
    await runDropCampaignDrafter({ artworkId, triggerKind: args.triggerKind ?? 'event' });
  } catch (err) {
    dropCampaignError = err instanceof Error ? err.message : String(err);
    console.error('drop campaign drafter failed (non-fatal):', dropCampaignError);
  }

  return {
    artworkId,
    shopifyHandle,
    shopifyProductId,
    syncWarnings: sync.warnings,
    mockupTaskId,
    dropCampaignError,
  };
}

export interface AutoPublishResult {
  artworkId: string;
  status: 'published' | 'timeout' | 'no_gelato_id' | 'no_shopify_product';
  gelato?: GelatoPublishedSummary;
  applied?: ApplyListedStateResult;
  message?: string;
}

/**
 * Auto-publish chain triggered after `pushToGelatoAction` completes:
 *   1. Look up the artwork's gelato_product_id.
 *   2. Poll Gelato until the auto-publish to Shopify lands.
 *   3. Fetch the matching Shopify product by handle to get the GID.
 *   4. Call `applyListedState` to run the rest of the chain.
 *
 * Designed to be called from a background `agent_tasks` runner so the
 * operator-facing action returns immediately. Idempotent — running on
 * an already-published artwork still triggers `applyListedState`,
 * which is idempotent itself.
 */
export async function autoPublishArtworkAfterGelatoCreate(args: {
  artworkId: string;
  pollTimeoutMs?: number;
}): Promise<AutoPublishResult> {
  const { artworkId, pollTimeoutMs } = args;

  const artwork = await getArtworkById(artworkId);
  if (!artwork) throw new Error('Artwork not found');
  if (!artwork.gelato_product_id) {
    return {
      artworkId,
      status: 'no_gelato_id',
      message: 'Artwork has no gelato_product_id — push to Gelato first.',
    };
  }

  // If the artwork already has a handle, we don't need to poll —
  // just re-run the listed-state chain (idempotent).
  if (artwork.shopify_handle) {
    const applied = await applyListedState({
      artworkId,
      shopifyHandle: artwork.shopify_handle,
      shopifyProductId: artwork.shopify_product_id ?? null,
      triggerKind: 'event',
    });
    return {
      artworkId,
      status: 'published',
      applied,
    };
  }

  const gelato = await pollGelatoUntilPublished(artwork.gelato_product_id, {
    timeoutMs: pollTimeoutMs ?? 60000,
  });
  if (!gelato) {
    return {
      artworkId,
      status: 'timeout',
      message:
        'Gelato auto-publish to Shopify did not complete within the poll window. ' +
        'Re-run /api/agents/run/auto_publisher when the Shopify product appears, ' +
        'or use the manual Mark-as-Listed path.',
    };
  }

  // Look up the Shopify product to get its numeric id (so we can
  // store the GID in the same format the operator pasted in the
  // legacy manual flow).
  const shopify = await getShopifyProductByHandle(gelato.handle);
  let shopifyProductId: string | null = null;
  if (shopify.ok && shopify.data) {
    shopifyProductId = `gid://shopify/Product/${shopify.data.id}`;
  } else {
    // Don't fail the chain — the handle alone is enough for the sync.
    // The GID can be backfilled later if needed.
    console.warn(
      `[post-create-publisher] Could not look up Shopify product for handle "${gelato.handle}": ${shopify.error ?? 'not found'}`
    );
  }

  const applied = await applyListedState({
    artworkId,
    shopifyHandle: gelato.handle,
    shopifyProductId,
    triggerKind: 'event',
  });

  return {
    artworkId,
    status: 'published',
    gelato,
    applied,
  };
}
