import { NextResponse } from 'next/server';
import { getArtworkById } from '@/lib/artworks';
import { composeArtworkMockups } from '@/lib/mockup-composer';
import { replaceShopifyProductImages } from '@/lib/shopify-admin';
import { startAgentTask, finishAgentTask } from '@/lib/agents/base';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // mockup compositing is image-heavy

/**
 * Compose the 6-image mockup set for an artwork:
 *   1 original (kept), 3 detail crops, 1 framed close-up, 1 in-room shot.
 *
 * Uses fire-and-forget via agent_tasks so the UI doesn't block. The
 * status pill on the artwork edit page surfaces progress; on completion
 * the artwork's `image_urls` JSONB is updated with the composed set.
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
          // Display order: original first (the artwork itself), then
          // framed close-up, in-room context, then 3 detail crops. Same
          // ordering used by lib/mockup-publisher.ts — keep them in
          // sync. Original-first is the right cover for an art store
          // where buyers want to see what they're actually getting
          // before context shots.
          const orderedImages = [
            { src: result.imageUrls.original, alt: `${artwork.title} — original artwork` },
            { src: result.imageUrls.framed, alt: `${artwork.title} — framed museum-quality matte print` },
            { src: result.imageUrls.inRoom, alt: `${artwork.title} — shown in a styled room interior` },
            { src: result.imageUrls.details[0], alt: `${artwork.title} — detail (center)` },
            { src: result.imageUrls.details[1], alt: `${artwork.title} — detail (upper third)` },
            { src: result.imageUrls.details[2], alt: `${artwork.title} — detail (lower third)` },
          ];
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
