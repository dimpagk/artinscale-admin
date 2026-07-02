import { NextResponse } from 'next/server';
import { getArtworkById } from '@/lib/artworks';
import { composeArtworkMockups } from '@/lib/mockup-composer';
import { mockupSetToShopifyOrder } from '@/lib/mockup-publisher';
import { replaceShopifyProductImages } from '@/lib/shopify-admin';
import { startAgentTask, finishAgentTask } from '@/lib/agents/base';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // mockup compositing is image-heavy

/**
 * Compose the 5-image mockup set for an artwork:
 *   1 original (kept), 2 focal detail crops, 1 framed close-up, 1 in-room shot.
 *
 * Uses fire-and-forget via agent_tasks so the UI doesn't block. The
 * status pill on the artwork edit page surfaces progress; on completion
 * the artwork's `mockup_urls` JSONB is updated with the composed set.
 *
 * POST /api/artworks/[id]/compose-mockups
 *   { force?: boolean, aestheticHint?: 'minimal'|'warm'|... }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let force = false;
  let aestheticHint: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    force = body.force === true;
    if (typeof body.aestheticHint === 'string') aestheticHint = body.aestheticHint;
  } catch {
    /* empty body is fine */
  }

  const artwork = await getArtworkById(id);
  if (!artwork) {
    return NextResponse.json({ error: 'Artwork not found' }, { status: 404 });
  }
  if (!artwork.image_url) {
    return NextResponse.json({ error: 'Artwork has no image_url' }, { status: 400 });
  }
  if (!artwork.product_type) {
    return NextResponse.json({ error: 'Artwork has no product_type — set the size first' }, { status: 400 });
  }

  const task = await startAgentTask({
    agentName: 'mockup-composer',
    triggerKind: 'manual',
    // Same correlation convention as the post-Gelato chain so the
    // artwork page's pipeline-activity card shows compose progress.
    correlationId: `artwork:${id}`,
    input: { artwork_id: id, product_type: artwork.product_type, force, aestheticHint: aestheticHint ?? null },
  });
  if (!task) {
    return NextResponse.json({ error: 'Failed to start task' }, { status: 500 });
  }

  void composeArtworkMockups({
    artworkId: id,
    sourceImageUrl: artwork.image_url,
    productType: artwork.product_type,
    aestheticHint: aestheticHint as never,
    force,
  })
    .then(async (result) => {
      // If the artwork is already listed on Shopify, push the composed
      // set onto the product's image gallery. This is the "Mark as
      // Listed → background mockup pipeline → Shopify product images"
      // chain; failures are non-fatal — recorded in task output and
      // operator can retry.
      let shopifyResult: { uploaded: number; deleted: number } | null = null;
      let shopifyError: string | null = null;
      if (artwork.shopify_handle && result.imageUrls) {
        try {
          // Display order comes from mockupSetToShopifyOrder (original
          // first as the cover, then framed, in-room, focal details) so
          // this stays in lockstep with lib/mockup-publisher.ts.
          const orderedImages = mockupSetToShopifyOrder(result.imageUrls, artwork.title);
          const uploadRes = await replaceShopifyProductImages({
            shopifyHandle: artwork.shopify_handle,
            images: orderedImages,
          });
          if (uploadRes.ok) {
            shopifyResult = uploadRes.data!;
          } else {
            shopifyError = uploadRes.error ?? 'unknown';
          }
        } catch (err) {
          shopifyError = err instanceof Error ? err.message : String(err);
        }
      }

      await finishAgentTask(task.id, {
        status: 'succeeded',
        output: {
          image_urls: result.imageUrls,
          generated: result.generated,
          errors: result.errors,
          shopify: shopifyResult ? { ...shopifyResult } : null,
          shopify_error: shopifyError,
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

/**
 * GET /api/artworks/[id]/compose-mockups
 *
 * Returns the artwork's current composed set (or null). The mockup
 * gallery card polls this after triggering a compose to pick up the
 * result without a full page reload.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const artwork = await getArtworkById(id);
  if (!artwork) {
    return NextResponse.json({ error: 'Artwork not found' }, { status: 404 });
  }
  return NextResponse.json({ mockup_urls: artwork.mockup_urls ?? null });
}
