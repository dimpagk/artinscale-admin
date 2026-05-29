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
