/**
 * External-print fulfillment.
 *
 * Triggered by the storefront's Shopify `orders/create` (or `orders/paid`)
 * webhook after a customer pays for an on-demand external print. For each
 * paid external-print line item:
 *
 *   1. Look up the external_prints row by canonical_key (sent in by the
 *      storefront from the product's metafields).
 *   2. Decide whether the print-ready image needs an upscale for the
 *      requested Gelato size (resize-to-fit before sending to Replicate,
 *      same logic as the original pre-payment pipeline).
 *   3. Upload the final print-ready image to the print-ready bucket.
 *   4. POST a Gelato order via the Order API with the print URL + the
 *      customer's shipping address.
 *   5. Log the Gelato order id back onto external_prints.last_ordered_at +
 *      order_count.
 *
 * Failure handling: per-line failures throw with a descriptive message.
 * The caller (the admin webhook endpoint) logs them; refund handling is
 * manual via Shopify admin in v1.
 */

import crypto from 'node:crypto';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { upscaleImage } from './upscaler';
import { uploadFile, getPublicUrl } from './storage';
import { createGelatoOrder, type GelatoShippingAddress } from './gelato-order';

// Mirror of the storefront's EXTERNAL_PRINT_PRICING — the productUid for
// each size + the minimum source-image width we need at 150 DPI. Kept
// duplicated rather than imported because storefront and admin are
// separate npm packages.
const SIZE_LOOKUP: Record<
  string,
  { productUid: string; widthCm: number; minPx150: number; recommendedPx300: number }
> = {
  '21x30': {
    productUid:
      'flat_a4-8x12-inch_250-gsm-100lb-uncoated-offwhite-archival_4-0_ver',
    widthCm: 21,
    minPx150: 1240,
    recommendedPx300: 2480,
  },
  '30x40': {
    productUid:
      'flat_300x400-mm-12x16-inch_250-gsm-100lb-uncoated-offwhite-archival_4-0_ver',
    widthCm: 30,
    minPx150: 1772,
    recommendedPx300: 3543,
  },
  '30x45': {
    productUid:
      'flat_300x450-mm-12x18-inch_250-gsm-100lb-uncoated-offwhite-archival_4-0_ver',
    widthCm: 30,
    minPx150: 1772,
    recommendedPx300: 3543,
  },
  '40x50': {
    productUid:
      'flat_400x500-mm-16x20-inch_250-gsm-100lb-uncoated-offwhite-archival_4-0_ver',
    widthCm: 40,
    minPx150: 2362,
    recommendedPx300: 4724,
  },
  '50x70': {
    productUid:
      'flat_500x700-mm-20x28-inch_250-gsm-100lb-uncoated-offwhite-archival_4-0_ver',
    widthCm: 50,
    minPx150: 2953,
    recommendedPx300: 5906,
  },
  '60x90': {
    productUid:
      'flat_600x900-mm-24x36-inch_250-gsm-100lb-uncoated-offwhite-archival_4-0_ver',
    widthCm: 60,
    minPx150: 3543,
    recommendedPx300: 7087,
  },
  '70x100': {
    productUid:
      'flat_700x1000-mm-28x40-inch_250-gsm-100lb-uncoated-offwhite-archival_4-0_ver',
    widthCm: 70,
    minPx150: 4134,
    recommendedPx300: 8268,
  },
};

const MAX_REPLICATE_INPUT_PIXELS = 2_000_000;

export interface FulfillExternalPrintLineArgs {
  /** Shopify order id — used as orderReferenceId on Gelato */
  shopifyOrderId: string | number;
  /** Shopify line item id — used as itemReferenceId on Gelato */
  shopifyLineItemId: string | number;
  /** Shopify numeric product_id — used to look up the external_prints row */
  shopifyProductId: string | number;
  /** Variant SKU pattern: "ext-<8char>-<size>" e.g. "ext-ec2affa4-21x30" — used to extract sizeKey */
  variantSku: string;
  /** Quantity ordered */
  quantity: number;
  /** Currency code (EUR, USD, etc.) */
  currency: string;
  /** Shopify customer reference id (or null for guest checkouts) */
  customerReferenceId: string | null;
  /** Shipping address forwarded from Shopify */
  shippingAddress: GelatoShippingAddress;
}

interface ExternalPrintRow {
  id: string;
  source: string;
  source_image_url: string;
  print_ready_url: string | null;
  source_image_width: number | null;
  source_image_height: number | null;
  order_count: number;
}

function parseSku(sku: string): { sizeKey: string } | null {
  // sku format: ext-<8-hex>-<sizeKey>  e.g. ext-ec2affa4-21x30
  // The 8-hex prefix is informational only (a sanity-check that the SKU
  // belongs to the right product); we look up the row via shopifyProductId.
  const m = /^ext-([0-9a-f]{8})-(\d{1,3}x\d{1,3})$/.exec(sku);
  if (!m || !m[2]) return null;
  return { sizeKey: m[2] };
}

async function fetchSourceBuffer(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Source fetch failed: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  return { buffer, contentType };
}

async function preparePrintFile(args: {
  externalPrintId: string;
  rehostedSourceUrl: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sizeKey: string;
}): Promise<string> {
  const sizeConfig = SIZE_LOOKUP[args.sizeKey];
  if (!sizeConfig) throw new Error(`Unknown size: ${args.sizeKey}`);

  let sourceWidth = args.sourceWidth;
  let sourceHeight = args.sourceHeight;

  // If we don't have dimensions on the row, fetch + measure.
  if (!sourceWidth || !sourceHeight) {
    const { buffer } = await fetchSourceBuffer(args.rehostedSourceUrl);
    const meta = await sharp(buffer).metadata();
    sourceWidth = meta.width ?? null;
    sourceHeight = meta.height ?? null;
    if (!sourceWidth || !sourceHeight) {
      throw new Error('Could not determine source image dimensions');
    }
  }

  // Already big enough at recommended DPI — ship the rehosted source as-is.
  if (sourceWidth >= sizeConfig.recommendedPx300) {
    return args.rehostedSourceUrl;
  }

  // Compute target scale to reach recommended (cap at 4x — Real-ESRGAN limit).
  const scaleNeeded = sizeConfig.recommendedPx300 / sourceWidth;
  const scale: 2 | 4 = scaleNeeded <= 2 ? 2 : 4;

  // If even 4x falls below the 150 DPI floor, we shouldn't have offered this
  // size at checkout time — but if we did, throw clearly here.
  const upscaledWidth = sourceWidth * scale;
  if (upscaledWidth < sizeConfig.minPx150) {
    throw new Error(
      `Source ${sourceWidth}x${sourceHeight} can't reach ${sizeConfig.minPx150}px even at 4x — refund this order`
    );
  }

  // Replicate has a ~2.1M input pixel cap. Resize down if needed.
  let upscaleInputUrl = args.rehostedSourceUrl;
  const sourcePixels = sourceWidth * sourceHeight;
  if (sourcePixels > MAX_REPLICATE_INPUT_PIXELS) {
    const ratio = Math.sqrt(MAX_REPLICATE_INPUT_PIXELS / sourcePixels);
    const targetWidth = Math.floor(sourceWidth * ratio);
    const { buffer } = await fetchSourceBuffer(args.rehostedSourceUrl);
    const resizedBuffer = await sharp(buffer).resize(targetWidth).toBuffer();
    const resizedPath = `${args.externalPrintId}/replicate-input-${crypto
      .randomBytes(3)
      .toString('hex')}.png`;
    await uploadFile('print-ready', resizedPath, resizedBuffer, {
      contentType: 'image/png',
    });
    upscaleInputUrl = getPublicUrl('print-ready', resizedPath);
  }

  // Upscale
  const upscaled = await upscaleImage({ imageUrl: upscaleInputUrl, scale });

  // Upload result to print-ready bucket and return that URL
  const upscaledPath = `${args.externalPrintId}/print-${args.sizeKey}-${crypto
    .randomBytes(3)
    .toString('hex')}.png`;
  await uploadFile('print-ready', upscaledPath, upscaled.buffer, {
    contentType: 'image/png',
  });
  return getPublicUrl('print-ready', upscaledPath);
}

export interface FulfillResult {
  externalPrintId: string;
  gelatoOrderId: string;
  fulfillmentStatus: string;
  isDryRun: boolean;
}

/**
 * Fulfill a single paid external-print line item.
 */
export async function fulfillExternalPrintLine(
  args: FulfillExternalPrintLineArgs
): Promise<FulfillResult> {
  const parsed = parseSku(args.variantSku);
  if (!parsed) {
    throw new Error(`Variant SKU does not look like an external print: ${args.variantSku}`);
  }
  const sizeConfig = SIZE_LOOKUP[parsed.sizeKey];
  if (!sizeConfig) {
    throw new Error(`Unknown size in SKU: ${parsed.sizeKey}`);
  }

  // Look up the external_prints row by Shopify product gid (stored at
  // PR1 create time as e.g. "gid://shopify/Product/15678460100938").
  const shopifyProductGid = `gid://shopify/Product/${args.shopifyProductId}`;
  const { data: row, error } = await supabaseAdmin
    .from('external_prints')
    .select(
      'id, source, source_image_url, print_ready_url, source_image_width, source_image_height, order_count'
    )
    .eq('shopify_product_id', shopifyProductGid)
    .maybeSingle();

  if (error || !row) {
    throw new Error(
      `External print not found for shopify_product_id ${shopifyProductGid} (SKU ${args.variantSku})`
    );
  }
  const r = row as ExternalPrintRow;

  // Use the rehosted source URL when available (always set by the PR1
  // create flow); fall back to the raw museum URL for legacy rows.
  const rehostedSourceUrl = r.print_ready_url ?? r.source_image_url;

  // Prepare the actual print-ready file for this specific size
  const printFileUrl = await preparePrintFile({
    externalPrintId: r.id,
    rehostedSourceUrl,
    sourceWidth: r.source_image_width,
    sourceHeight: r.source_image_height,
    sizeKey: parsed.sizeKey,
  });

  // Drop the Gelato order
  const gelatoOrder = await createGelatoOrder({
    shopifyOrderId: args.shopifyOrderId,
    customerReferenceId: args.customerReferenceId,
    currency: args.currency,
    shippingAddress: args.shippingAddress,
    items: [
      {
        itemReferenceId: String(args.shopifyLineItemId),
        productUid: sizeConfig.productUid,
        printFileUrl,
        quantity: args.quantity,
      },
    ],
  });

  // Bump order_count + timestamp on the row
  await supabaseAdmin
    .from('external_prints')
    .update({
      order_count: (r.order_count ?? 0) + args.quantity,
      last_ordered_at: new Date().toISOString(),
    })
    .eq('id', r.id);

  return {
    externalPrintId: r.id,
    gelatoOrderId: gelatoOrder.id,
    fulfillmentStatus: gelatoOrder.fulfillmentStatus,
    isDryRun: gelatoOrder.isDryRun ?? false,
  };
}
