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
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { upscaleImage } from './upscaler';
import { uploadFile, getPublicUrl } from './storage';
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

// Source-aware fetch headers. Some museum image servers (AIC's IIIF in
// particular) return 403 to anonymous fetches; we send the attribution
// headers their API conventions document. Sources not listed here use
// no extra headers.
function headersForSource(source: string): Record<string, string> {
  switch (source) {
    case 'aic':
      return {
        'AIC-User-Agent': 'ArtInScale/1.0 (contact: hello@artinscale.com)',
      };
    default:
      return {};
  }
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
    // 2. Fetch source image bytes with source-aware headers. Some museum
    //    image servers (notably AIC's IIIF) require attribution headers
    //    and return 403 to anonymous fetches — that means Gelato +
    //    Replicate also can't reach those URLs directly. We rehost to
    //    Supabase below so the rest of the pipeline doesn't care.
    await updateStatus(row.id, 'fetching');
    const sourceHeaders = headersForSource(row.source);
    const sourceRes = await fetch(row.source_image_url, { headers: sourceHeaders });
    if (!sourceRes.ok) {
      await markError(
        row.id,
        `Source fetch failed: HTTP ${sourceRes.status} from ${row.source}`
      );
      return;
    }
    const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());
    const sourceContentType = sourceRes.headers.get('content-type') || 'image/jpeg';

    // Get dimensions from the buffer (works regardless of upstream hosting
    // quirks). sharp is already an admin dep — used by mockup-composer.
    let sourceWidth = row.source_image_width;
    let sourceHeight = row.source_image_height;
    if (!sourceWidth || !sourceHeight) {
      const meta = await sharp(sourceBuffer).metadata();
      sourceWidth = meta.width ?? sourceWidth ?? null;
      sourceHeight = meta.height ?? sourceHeight ?? null;
      if (!sourceWidth || !sourceHeight) {
        await markError(row.id, 'Could not determine source image dimensions from buffer');
        return;
      }
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

    // 4. Always rehost source to Supabase — gives us a hotlink-friendly
    //    URL for both Replicate (upscale) and Gelato to fetch from,
    //    regardless of the upstream's anti-hotlinking policy.
    await updateStatus(row.id, 'rendering');
    const sourceExt = sourceContentType.includes('png') ? 'png' : 'jpg';
    const sourcePath = `${row.id}/source-${crypto.randomBytes(3).toString('hex')}.${sourceExt}`;
    await uploadFile('print-ready', sourcePath, sourceBuffer, {
      contentType: sourceContentType,
    });
    let printImageUrl = getPublicUrl('print-ready', sourcePath);

    if (needsUpscale) {
      await updateStatus(row.id, 'upscaling');

      // Real-ESRGAN on Replicate has a GPU memory cap of ~2.1M input
      // pixels (1448×1448 square). Any larger and the prediction returns
      // 400. Resize down to fit (preserving aspect) before sending.
      let upscaleInputUrl = printImageUrl;
      const MAX_REPLICATE_PIXELS = 2_000_000; // 5% headroom below the documented cap
      const sourcePixels = sourceWidth * sourceHeight;
      if (sourcePixels > MAX_REPLICATE_PIXELS) {
        const ratio = Math.sqrt(MAX_REPLICATE_PIXELS / sourcePixels);
        const targetWidth = Math.floor(sourceWidth * ratio);
        const resizedBuffer = await sharp(sourceBuffer).resize(targetWidth).toBuffer();
        const resizedPath = `${row.id}/replicate-input-${crypto.randomBytes(3).toString('hex')}.png`;
        await uploadFile('print-ready', resizedPath, resizedBuffer, {
          contentType: 'image/png',
        });
        upscaleInputUrl = getPublicUrl('print-ready', resizedPath);
      }

      // Pick the smallest scale that meets recommended (saves Replicate cost).
      const scale: 2 | 4 =
        sourceWidth * 2 >= template.config.recommendedImageWidthPx ? 2 : 4;
      const upscaled = await upscaleImage({ imageUrl: upscaleInputUrl, scale });

      await updateStatus(row.id, 'rendering');
      const upscaledPath = `${row.id}/${template.key}-${crypto.randomBytes(3).toString('hex')}.png`;
      await uploadFile('print-ready', upscaledPath, upscaled.buffer, {
        contentType: 'image/png',
      });
      printImageUrl = getPublicUrl('print-ready', upscaledPath);
    }

    await supabaseAdmin
      .from('external_prints')
      .update({
        print_ready_url: printImageUrl,
        max_print_size: template.key,
      })
      .eq('id', row.id);

    // 5. Create the Gelato product
    await updateStatus(row.id, 'creating_gelato');
    const title = row.artist ? `${row.title} — ${row.artist}` : row.title;
    const description = [
      row.title,
      row.attribution_text,
      'Public-domain reproduction, printed on-demand on archival matte paper.',
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
