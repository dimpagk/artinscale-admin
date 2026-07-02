import { NextRequest, NextResponse } from 'next/server';
import { upsertOrderFromShopify, type ShopifyOrderInput } from '@/lib/orders';

/**
 * POST /api/orders/ingest
 *
 * Cross-app hook from the storefront's Shopify orders webhook. Upserts
 * the order into the admin's `orders` table so the operator manages the
 * whole Shopify + Gelato lifecycle from one place. The order_sync cron
 * later enriches each row with its Gelato status.
 *
 * Auth: same AGENT_TRIGGER_TOKEN / x-trigger-token pattern as the rest
 * of the cross-app endpoints (see /api/external/fulfill-order).
 *
 * Body: a single Shopify order object, or { order: <shopify order> }.
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

  let body: ShopifyOrderInput | { order?: ShopifyOrderInput };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const order = 'order' in body && body.order ? body.order : (body as ShopifyOrderInput);
  if (!order?.id) {
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
  }

  const result = await upsertOrderFromShopify(order);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
