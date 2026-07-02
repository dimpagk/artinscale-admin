/**
 * Gelato Order API client.
 *
 * Distinct from `lib/gelato.ts` which speaks the eCommerce API (creates
 * Gelato products + Shopify products). For on-demand external prints we
 * skip the product layer entirely — the customer's Shopify product is
 * created by the storefront (lib/shopify/external-print-product.ts there)
 * and we drop the fulfillment directly into Gelato's Order API at the
 * point of payment.
 *
 * Docs: https://docs.gelato.com/reference/post_v4-orders-create
 */

const GELATO_API_KEY = process.env.GELATO_API_KEY;
const GELATO_DRY_RUN = process.env.GELATO_DRY_RUN === 'true';
const ORDER_API_BASE = 'https://order.gelatoapis.com/v4';

export interface GelatoShippingAddress {
  firstName: string;
  lastName: string;
  companyName?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  postCode: string;
  country: string; // ISO 3166-1 alpha-2
  state?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface GelatoOrderItem {
  /** Stable per-line-item id we send to Gelato. We use Shopify line_item_id. */
  itemReferenceId: string;
  /** Gelato catalog SKU — from EXTERNAL_PRINT_PRICING in storefront */
  productUid: string;
  /** Public URL of the print-ready image (rehosted + optionally upscaled) */
  printFileUrl: string;
  quantity: number;
}

export interface CreateGelatoOrderArgs {
  /** Shopify order id — used as Gelato's orderReferenceId for traceability + idempotency */
  shopifyOrderId: string | number;
  customerReferenceId: string | null;
  currency: string;
  items: GelatoOrderItem[];
  shippingAddress: GelatoShippingAddress;
}

export interface GelatoOrderResponse {
  id: string;
  orderReferenceId: string;
  fulfillmentStatus: string;
  financialStatus: string;
  /** Set when GELATO_DRY_RUN=true — caller can short-circuit downstream effects. */
  isDryRun?: boolean;
}

function buildPayload(args: CreateGelatoOrderArgs) {
  return {
    orderType: 'order',
    orderReferenceId: `shopify-${args.shopifyOrderId}`,
    customerReferenceId: args.customerReferenceId ?? `shopify-${args.shopifyOrderId}`,
    currency: args.currency,
    shippingAddress: args.shippingAddress,
    items: args.items.map((i) => ({
      itemReferenceId: i.itemReferenceId,
      productUid: i.productUid,
      quantity: i.quantity,
      files: [
        {
          type: 'default',
          url: i.printFileUrl,
        },
      ],
    })),
  };
}

export async function createGelatoOrder(
  args: CreateGelatoOrderArgs
): Promise<GelatoOrderResponse> {
  const payload = buildPayload(args);

  if (GELATO_DRY_RUN) {
    const fakeId = `dry-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log('[gelato-order] DRY RUN — would have posted:', JSON.stringify(payload).slice(0, 500));
    return {
      id: fakeId,
      orderReferenceId: payload.orderReferenceId,
      fulfillmentStatus: 'created',
      financialStatus: 'draft',
      isDryRun: true,
    };
  }

  if (!GELATO_API_KEY) {
    throw new Error('GELATO_API_KEY missing — cannot post Gelato order');
  }

  const res = await fetch(`${ORDER_API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'X-API-KEY': GELATO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gelato Order API ${res.status}: ${errBody.slice(0, 500)}`);
  }

  const body = (await res.json()) as {
    id?: string;
    orderReferenceId?: string;
    fulfillmentStatus?: string;
    financialStatus?: string;
  };

  if (!body.id) {
    throw new Error(`Gelato Order API returned no id: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return {
    id: body.id,
    orderReferenceId: body.orderReferenceId ?? payload.orderReferenceId,
    fulfillmentStatus: body.fulfillmentStatus ?? 'unknown',
    financialStatus: body.financialStatus ?? 'unknown',
  };
}

// ────────────────────────────────────────────────────────────────
// Read + approve helpers (used by the admin Orders view).
//
// Orders created by Gelato's own Shopify connector land here in
// `pending_approval` when the store requires manual approval. The admin
// surfaces them and approves in place so the operator never has to open
// the Gelato dashboard.
// ────────────────────────────────────────────────────────────────

/** Compact, admin-friendly projection of a raw Gelato order. */
export interface GelatoOrderSummary {
  id: string;
  orderReferenceId: string | null;
  /** Shopify numeric order id this Gelato order was created from. */
  externalOrderId: string | null;
  orderType: string | null; // 'order' | 'approval_request' | 'draft'
  fulfillmentStatus: string | null; // 'pending_approval' | 'printing' | 'shipped' | ...
  financialStatus: string | null;
  currency: string | null;
  /** Sum of Gelato item prices (our cost), for margin. Null if not priced yet. */
  itemCost: number | null;
  /** Rendered default preview of the first item, if Gelato has produced one. */
  previewUrl: string | null;
  /** First tracking URL, once shipped. */
  trackingUrl: string | null;
}

interface RawGelatoOrder {
  id?: string;
  orderReferenceId?: string;
  orderExternalId?: string;
  orderType?: string;
  fulfillmentStatus?: string;
  financialStatus?: string;
  currency?: string;
  metadata?: Array<{ key?: string; value?: string }>;
  items?: Array<{
    price?: number | string;
    previews?: Array<{ type?: string; url?: string }>;
  }>;
  shipment?: { trackingUrl?: string } | null;
  shipments?: Array<{ trackingUrl?: string }>;
}

function extractExternalOrderId(raw: RawGelatoOrder): string | null {
  if (raw.orderExternalId) return raw.orderExternalId;
  const meta = (raw.metadata ?? []).find((m) => m.key === 'externalOrderId');
  return meta?.value ?? null;
}

export function normalizeGelatoOrder(raw: RawGelatoOrder): GelatoOrderSummary {
  const items = raw.items ?? [];
  let itemCost: number | null = null;
  for (const it of items) {
    const p = typeof it.price === 'string' ? parseFloat(it.price) : it.price;
    if (typeof p === 'number' && !Number.isNaN(p)) itemCost = (itemCost ?? 0) + p;
  }
  const previewUrl =
    items[0]?.previews?.find((p) => p.type === 'preview_default')?.url ??
    items[0]?.previews?.[0]?.url ??
    null;
  const trackingUrl = raw.shipment?.trackingUrl ?? raw.shipments?.[0]?.trackingUrl ?? null;

  return {
    id: raw.id ?? '',
    orderReferenceId: raw.orderReferenceId ?? null,
    externalOrderId: extractExternalOrderId(raw),
    orderType: raw.orderType ?? null,
    fulfillmentStatus: raw.fulfillmentStatus ?? null,
    financialStatus: raw.financialStatus ?? null,
    currency: raw.currency ?? null,
    itemCost,
    previewUrl,
    trackingUrl,
  };
}

function requireApiKey(): string {
  if (!GELATO_API_KEY) throw new Error('GELATO_API_KEY missing, cannot call Gelato Order API');
  return GELATO_API_KEY;
}

/** GET a single Gelato order, normalized. Returns null on 404. */
export async function getGelatoOrder(orderId: string): Promise<GelatoOrderSummary | null> {
  const res = await fetch(`${ORDER_API_BASE}/orders/${orderId}`, {
    headers: { 'X-API-KEY': requireApiKey() },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Gelato get order ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return normalizeGelatoOrder((await res.json()) as RawGelatoOrder);
}

/**
 * Search recent Gelato orders. Used by the reconcile sync to match
 * Shopify orders to their Gelato counterparts by external id.
 */
export async function searchGelatoOrders(limit = 100): Promise<GelatoOrderSummary[]> {
  const res = await fetch(`${ORDER_API_BASE}/orders:search`, {
    method: 'POST',
    headers: { 'X-API-KEY': requireApiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) {
    throw new Error(`Gelato search orders ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { orders?: RawGelatoOrder[] };
  return (body.orders ?? []).map(normalizeGelatoOrder);
}

/**
 * Approve a draft / pending-approval Gelato order, moving it into
 * production. Gelato's v4 approval is a PATCH that flips `orderType`
 * from the draft/approval state to `order`.
 *
 * Charges the operator and ships a physical item, so callers must gate
 * this behind an explicit operator action. Honours GELATO_DRY_RUN.
 */
export async function approveGelatoOrder(
  orderId: string
): Promise<{ ok: boolean; status?: GelatoOrderSummary; error?: string; isDryRun?: boolean }> {
  if (GELATO_DRY_RUN) {
    console.log(`[gelato-order] DRY RUN — would approve order ${orderId}`);
    return { ok: true, isDryRun: true };
  }
  const res = await fetch(`${ORDER_API_BASE}/orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'X-API-KEY': requireApiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderType: 'order' }),
  });
  if (!res.ok) {
    return { ok: false, error: `Gelato approve ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }
  const status = normalizeGelatoOrder((await res.json()) as RawGelatoOrder);
  return { ok: true, status };
}
