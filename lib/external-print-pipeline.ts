/**
 * External-print on-demand pipeline.
 *
 * Triggered by storefront → admin webhook when a customer requests a
 * print of a public-domain museum piece that doesn't have a Shopify
 * product yet. Runs end-to-end in the background:
 *
 *   row ↦ fetch dims ↦ pick template ↦ upscale (if sub-DPI)
 *       ↦ upload print-ready ↦ createGelatoProduct
 *       ↦ poll Gelato until Shopify auto-publish lands
 *       ↦ updateShopifyProductCore (status=draft, hidden tags)
 *       ↦ write IDs back to external_prints row
 *
 * Idempotent: returns early if the row is already at `shopify_created`.
 * On any failure, updates the row's status to 'error' with the message.
 *
 * Note: deliberately leaner than the artwork pipeline (no drop campaign
 * drafter, no mockup pipeline) — external prints are not part of the
 * curated drops.
 */

import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { upscaleImage } from './upscaler';
import { uploadFile, getPublicUrl } from './storage';
import { fetchImageDimensions } from './image-dimensions';
import { createGelatoProduct } from './gelato';
import { pollGelatoUntilPublished } from './post-create-publisher';
import { updateShopifyProductCore } from './shopify-admin';
import { getTemplateConfig, listLaunchEnabledProductTypes } from './gelato-templates';

// Granular pipeline states, matching the CHECK constraint in
// sql/021_external_prints.sql. The storefront's print-status endpoint
// collapses these into customer-facing buckets (in_progress / ready /
// error) — the granularity here is for operator debugging.
type ExternalPrintStatus =
  | 'discovered'
  | 'in_progress'
  | 'fetching'
  | 'upscaling'
  | 'rendering'
  | 'creating_gelato'
  | 'creating_shopify'
  | 'shopify_created'
  | 'retired'
  | 'error';

interface ExternalPrintRow {
  id: string;
  source: string;
  source_id: string;
  canonical_key: string;
  title: string;
  artist: string | null;
  attribution_text: string;
  source_image_url: string;
  source_image_width: number | null;
  source_image_height: number | null;
  status: ExternalPrintStatus;
}

// Tags applied to both the Gelato product (forwarded to Shopify on
// auto-publish) and re-applied via updateShopifyProductCore to ensure
// the product is filterable and visibly excluded from public collections.
const HIDDEN_TAGS = ['external', 'hidden', 'on-demand'];
const PRODUCT_VENDOR = 'ArtInScale Open Library';
const PRODUCT_TYPE_LABEL = 'On-Demand Print';

async function updateStatus(
  id: string,
  status: ExternalPrintStatus,
  patch: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('external_prints')
    .update({ status, ...patch })
    .eq('id', id);
  if (error) {
    console.error(`[external-print-pipeline] status update failed (${id} → ${status}):`, error);
  }
}

async function markError(id: string, message: string): Promise<void> {
  await updateStatus(id, 'error', { error_message: message });
}

export async function runExternalPrintPipeline(externalPrintId: string): Promise<void> {
  // 1. Load row
  const { data: rowData, error: readError } = await supabaseAdmin
    .from('external_prints')
    .select(
      'id, source, source_id, canonical_key, title, artist, attribution_text, source_image_url, source_image_width, source_image_height, status'
    )
    .eq('id', externalPrintId)
    .single();

  if (readError || !rowData) {
    console.error(`[external-print-pipeline] row not found: ${externalPrintId}`, readError);
    return;
  }
  const row = rowData as ExternalPrintRow;

  // Idempotency: skip if already terminal-ok
  if (row.status === 'shopify_created') {
    console.log(`[external-print-pipeline] ${row.id} already shopify_created — skipping`);
    return;
  }

  try {
    // 2. Ensure source dimensions
    await updateStatus(row.id, 'fetching');
    let sourceWidth = row.source_image_width;
    let sourceHeight = row.source_image_height;
    if (!sourceWidth || !sourceHeight) {
      const dims = await fetchImageDimensions(row.source_image_url);
      if (!dims) {
        await markError(row.id, 'Could not determine source image dimensions');
        return;
      }
      sourceWidth = dims.width;
      sourceHeight = dims.height;
      await supabaseAdmin
        .from('external_prints')
        .update({
          source_image_width: sourceWidth,
          source_image_height: sourceHeight,
        })
        .eq('id', row.id);
    }

    // 3. Pick the largest enabled template the source can support
    //    (with up to 4x upscale). v1 ships with whichever templates the
    //    operator has flipped `enabledForLaunch: true` — currently just
    //    museum-poster-21x30.
    const eligible = listLaunchEnabledProductTypes()
      .map((key) => {
        const config = getTemplateConfig(key);
        return config ? { key, config } : null;
      })
      .filter((t): t is { key: string; config: ReturnType<typeof getTemplateConfig> & object } => !!t);

    if (eligible.length === 0) {
      await markError(row.id, 'No Gelato templates are launch-enabled');
      return;
    }

    const sortedBySize = [...eligible].sort(
      (a, b) => b.config.recommendedImageWidthPx - a.config.recommendedImageWidthPx
    );

    const fits = sortedBySize.find(
      (t) => sourceWidth! * 4 >= t.config.minImageWidthPx
    );

    if (!fits) {
      const smallestNeeded = Math.min(
        ...eligible.map((t) => t.config.minImageWidthPx)
      );
      await markError(
        row.id,
        `Source ${sourceWidth}x${sourceHeight} too small for any enabled template (smallest needs ${smallestNeeded}px wide, even with 4x upscale)`
      );
      return;
    }

    const template = fits;
    const needsUpscale = sourceWidth < template.config.recommendedImageWidthPx;

    // 4. Prepare the print-ready image
    let printImageUrl = row.source_image_url;

    if (needsUpscale) {
      await updateStatus(row.id, 'upscaling');
      // Pick the smallest scale that meets recommended; saves Replicate cost
      const scale: 2 | 4 =
        sourceWidth * 2 >= template.config.recommendedImageWidthPx ? 2 : 4;
      const upscaled = await upscaleImage({
        imageUrl: row.source_image_url,
        scale,
      });

      await updateStatus(row.id, 'rendering');
      const path = `${row.id}/${template.key}-${crypto.randomBytes(3).toString('hex')}.png`;
      await uploadFile('print-ready', path, upscaled.buffer, {
        contentType: 'image/png',
      });
      printImageUrl = getPublicUrl('print-ready', path);

      await supabaseAdmin
        .from('external_prints')
        .update({
          print_ready_url: printImageUrl,
          max_print_size: template.key,
        })
        .eq('id', row.id);
    } else {
      // Source already big enough; no upload needed. Record the chosen
      // template for ops visibility.
      await supabaseAdmin
        .from('external_prints')
        .update({ max_print_size: template.key })
        .eq('id', row.id);
    }

    // 5. Create the Gelato product
    await updateStatus(row.id, 'creating_gelato');
    const title = row.artist ? `${row.title} — ${row.artist}` : row.title;
    const description = [
      row.title,
      row.attribution_text,
      'Public-domain reproduction, printed on-demand on museum-quality matte paper.',
    ].join('\n\n');

    const gelatoProduct = await createGelatoProduct({
      title,
      description,
      imageUrl: printImageUrl,
      productType: template.key,
      tags: HIDDEN_TAGS,
    });

    await supabaseAdmin
      .from('external_prints')
      .update({ gelato_product_id: gelatoProduct.id })
      .eq('id', row.id);

    // 6. Wait for Gelato to auto-publish to Shopify (~15s)
    await updateStatus(row.id, 'creating_shopify');
    const published = await pollGelatoUntilPublished(gelatoProduct.id);

    if (!published) {
      await markError(
        row.id,
        `Gelato product ${gelatoProduct.id} did not auto-publish to Shopify within timeout`
      );
      return;
    }

    // 7. Hide the Shopify product. Gelato publishes with status=active by
    //    default; we want it as draft + tagged so it can't be discovered
    //    from public collections or search.
    const hideResult = await updateShopifyProductCore({
      shopifyHandle: published.handle,
      fields: {
        status: 'draft',
        tags: HIDDEN_TAGS,
        vendor: PRODUCT_VENDOR,
        productType: PRODUCT_TYPE_LABEL,
      },
    });

    if (!hideResult.ok) {
      // Non-fatal: the product exists, the order flow works (hidden
      // products can still be ordered via direct URL), but the public
      // exclusion isn't enforced. Operator should fix manually.
      console.warn(
        `[external-print-pipeline] failed to hide ${published.handle}: ${hideResult.error}`
      );
    }

    // 8. Finalize
    await supabaseAdmin
      .from('external_prints')
      .update({
        shopify_product_id: String(published.productId),
        shopify_handle: published.handle,
        status: 'shopify_created',
      })
      .eq('id', row.id);

    console.log(
      `[external-print-pipeline] ${row.id} → ${published.handle} (${template.key})`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[external-print-pipeline] ${externalPrintId} pipeline failed:`, err);
    await markError(externalPrintId, message);
  }
}
