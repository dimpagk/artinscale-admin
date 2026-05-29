import { NextRequest, NextResponse, after } from 'next/server';
import {
  fulfillExternalPrintLine,
  type FulfillExternalPrintLineArgs,
} from '@/lib/external-fulfillment';

/**
 * POST /api/external/fulfill-order
 *
 * Cross-app webhook from the storefront's Shopify `orders/create` /
 * `orders/paid` handler when a paid order contains one or more external-print
 * line items. Returns 200 immediately; runs the actual fulfillment in
 * the background via `after()`.
 *
 * Auth: same AGENT_TRIGGER_TOKEN pattern as the rest of /api/external/.
 *
 * Body shape:
 *   {
 *     lines: Array<{
 *       shopifyOrderId, shopifyLineItemId, variantSku, quantity,
 *       currency, customerReferenceId, shippingAddress
 *     }>
 *   }
 */

const AGENT_TRIGGER_TOKEN = process.env.AGENT_TRIGGER_TOKEN;

function unauthorized(reason: string): NextResponse {
  return NextResponse.json({ error: `Unauthorized: ${reason}` }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-trigger-token');
  if (AGENT_TRIGGER_TOKEN && token !== AGENT_TRIGGER_TOKEN) {
    return unauthorized('bad token');
  }
  if (!AGENT_TRIGGER_TOKEN) {
    const url = new URL(request.url);
    const localOnly = ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);
    if (!localOnly) return unauthorized('AGENT_TRIGGER_TOKEN not configured');
  }

  let body: { lines?: FulfillExternalPrintLineArgs[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const lines = body.lines ?? [];
  if (lines.length === 0) {
    return NextResponse.json({ accepted: true, lines: 0 });
  }

  after(async () => {
    for (const line of lines) {
      try {
        const result = await fulfillExternalPrintLine(line);
        console.log(
          `[fulfill-order] OK shopify_order=${line.shopifyOrderId} line=${line.shopifyLineItemId} → gelato_order=${result.gelatoOrderId} status=${result.fulfillmentStatus}${
            result.isDryRun ? ' [DRY RUN]' : ''
          }`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[fulfill-order] FAIL shopify_order=${line.shopifyOrderId} line=${line.shopifyLineItemId} sku=${line.variantSku}: ${message}`
        );
        // v1: log only. Operator handles refunds manually via Shopify admin.
        // PR3 will add structured failure tracking + auto-refund hook.
      }
    }
  });

  return NextResponse.json({ accepted: true, lines: lines.length });
}
