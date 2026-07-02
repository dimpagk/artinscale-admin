import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  getGelatoOrder,
  listGelatoOrdersDetailed,
  type GelatoOrderSummary,
} from '@/lib/gelato-order';

/**
 * Order records: the admin's single view over the Shopify + Gelato
 * lifecycle. See sql/025_orders.sql. Rows are written by the ingest
 * webhook and refreshed by the order_sync cron (reconcile + Gelato
 * status). All reads/writes use the service-role client.
 */

export interface OrderLineItem {
  title: string;
  sku: string | null;
  variant_title: string | null;
  quantity: number;
  price: number | null;
  product_id: string | null;
  image_url: string | null;
}

export interface OrderShippingAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  zip: string | null;
  province: string | null;
  country_code: string | null;
}

export interface OrderRow {
  id: string;
  shopify_order_id: string;
  shopify_order_number: string | null;
  name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  currency: string;
  subtotal_price: number | null;
  shipping_price: number | null;
  total_price: number | null;
  financial_status: string | null;
  shopify_fulfillment_status: string | null;
  shipping_address: OrderShippingAddress | null;
  line_items: OrderLineItem[];
  gelato_order_id: string | null;
  gelato_reference_id: string | null;
  gelato_order_type: string | null;
  gelato_fulfillment_status: string | null;
  gelato_financial_status: string | null;
  gelato_item_cost: number | null;
  gelato_preview_url: string | null;
  gelato_tracking_url: string | null;
  gelato_synced_at: string | null;
  placed_at: string | null;
  created_at: string;
  updated_at: string;
}

const ORDER_COLUMNS =
  'id, shopify_order_id, shopify_order_number, name, customer_name, customer_email, currency, subtotal_price, shipping_price, total_price, financial_status, shopify_fulfillment_status, shipping_address, line_items, gelato_order_id, gelato_reference_id, gelato_order_type, gelato_fulfillment_status, gelato_financial_status, gelato_item_cost, gelato_preview_url, gelato_tracking_url, gelato_synced_at, placed_at, created_at, updated_at';

// A Gelato order needs the operator's approval before it prints. This is
// the state the Orders view exists to make visible and actionable.
export const NEEDS_APPROVAL_STATES = new Set(['pending_approval']);
export const NEEDS_APPROVAL_ORDER_TYPES = new Set(['approval_request', 'draft']);

export function orderNeedsApproval(o: OrderRow): boolean {
  if (o.gelato_fulfillment_status && NEEDS_APPROVAL_STATES.has(o.gelato_fulfillment_status)) {
    return true;
  }
  return !!o.gelato_order_type && NEEDS_APPROVAL_ORDER_TYPES.has(o.gelato_order_type);
}

export async function getOrders(): Promise<OrderRow[]> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(ORDER_COLUMNS)
    .order('placed_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('Error fetching orders:', error);
    return [];
  }
  return (data ?? []) as OrderRow[];
}

export async function getOrderById(id: string): Promise<OrderRow | null> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`getOrderById(${id}) failed:`, error);
    return null;
  }
  return (data as OrderRow) ?? null;
}

// ────────────────────────────────────────────────────────────────
// Ingest: map a Shopify order (webhook payload or Admin API order) to a
// row and upsert on shopify_order_id.
// ────────────────────────────────────────────────────────────────

export interface ShopifyOrderInput {
  id?: number | string;
  order_number?: number | string;
  name?: string;
  email?: string | null;
  currency?: string;
  subtotal_price?: string | number | null;
  total_price?: string | number | null;
  total_shipping_price_set?: { shop_money?: { amount?: string } };
  shipping_lines?: Array<{ price?: string | number }>;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  created_at?: string;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
  shipping_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    zip?: string | null;
    province?: string | null;
    province_code?: string | null;
    country_code?: string | null;
  } | null;
  line_items?: Array<{
    title?: string;
    name?: string;
    sku?: string | null;
    variant_title?: string | null;
    quantity?: number;
    price?: string | number | null;
    product_id?: number | string | null;
  }>;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isNaN(n) ? null : n;
}

function shippingPrice(o: ShopifyOrderInput): number | null {
  const fromSet = o.total_shipping_price_set?.shop_money?.amount;
  if (fromSet !== undefined) return num(fromSet);
  const lines = o.shipping_lines ?? [];
  if (lines.length === 0) return null;
  return lines.reduce((s, l) => s + (num(l.price) ?? 0), 0);
}

function mapShopifyOrder(o: ShopifyOrderInput): Record<string, unknown> {
  const ship = o.shipping_address ?? null;
  const nameFromCustomer = [o.customer?.first_name, o.customer?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const nameFromShip = [ship?.first_name, ship?.last_name].filter(Boolean).join(' ').trim();
  const customerName = ship?.name ?? (nameFromCustomer || nameFromShip || null);

  const lineItems: OrderLineItem[] = (o.line_items ?? []).map((li) => ({
    title: li.title ?? li.name ?? 'Untitled',
    sku: li.sku ?? null,
    variant_title: li.variant_title ?? null,
    quantity: li.quantity ?? 1,
    price: num(li.price ?? null),
    product_id: li.product_id != null ? String(li.product_id) : null,
    image_url: null,
  }));

  const shippingAddress: OrderShippingAddress | null = ship
    ? {
        name: ship.name ?? customerName,
        address1: ship.address1 ?? null,
        address2: ship.address2 ?? null,
        city: ship.city ?? null,
        zip: ship.zip ?? null,
        province: ship.province ?? ship.province_code ?? null,
        country_code: ship.country_code ?? null,
      }
    : null;

  const row: Record<string, unknown> = {
    shopify_order_id: String(o.id ?? ''),
    shopify_order_number: o.order_number != null ? String(o.order_number) : null,
    name: o.name ?? (o.order_number != null ? `#${o.order_number}` : null),
    currency: o.currency ?? 'EUR',
    subtotal_price: num(o.subtotal_price ?? null),
    shipping_price: shippingPrice(o),
    total_price: num(o.total_price ?? null),
    financial_status: o.financial_status ?? null,
    shopify_fulfillment_status: o.fulfillment_status ?? null,
    line_items: lineItems,
    placed_at: o.created_at ?? null,
    updated_at: new Date().toISOString(),
  };

  // Only write PII when Shopify actually returned it. The Admin token
  // redacts customer data without the protected-customer-data scope, and
  // the reconcile runs on every sync: if we wrote nulls here we would
  // clobber the name/address that syncGelatoStatuses backfilled from
  // Gelato (which it stops doing once an order ships). Omitting the keys
  // leaves any existing value untouched on upsert.
  const customerEmail = o.email ?? o.customer?.email ?? null;
  if (customerName) row.customer_name = customerName;
  if (customerEmail) row.customer_email = customerEmail;
  if (shippingAddress && (shippingAddress.address1 || shippingAddress.city)) {
    row.shipping_address = shippingAddress;
  }

  return row;
}

export async function upsertOrderFromShopify(
  o: ShopifyOrderInput
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const shopifyId = String(o.id ?? '');
  if (!shopifyId) return { ok: false, error: 'missing Shopify order id' };

  const row = mapShopifyOrder(o);
  const { data, error } = await supabaseAdmin
    .from('orders')
    .upsert(row, { onConflict: 'shopify_order_id' })
    .select('id')
    .single();

  if (error) {
    console.error(`upsertOrderFromShopify(${shopifyId}) failed:`, error);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id: string }).id };
}

async function applyGelatoToOrder(order: OrderRow, g: GelatoOrderSummary): Promise<void> {
  const update: Record<string, unknown> = {
    gelato_order_id: g.id,
    gelato_reference_id: g.orderReferenceId,
    gelato_order_type: g.orderType,
    gelato_fulfillment_status: g.fulfillmentStatus,
    gelato_financial_status: g.financialStatus,
    gelato_item_cost: g.itemCost,
    gelato_preview_url: g.previewUrl,
    gelato_tracking_url: g.trackingUrl,
    gelato_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Shopify's Admin API redacts customer PII unless the token has the
  // protected-customer-data scope, so name/email/address come back null.
  // Gelato has the real shipping details, so backfill from there when the
  // row is missing them.
  if (!order.customer_name && g.customerName) update.customer_name = g.customerName;
  if (!order.customer_email && g.customerEmail) update.customer_email = g.customerEmail;
  const hasShip = order.shipping_address?.address1 || order.shipping_address?.city;
  if (!hasShip && g.shipping) update.shipping_address = g.shipping;

  const { error } = await supabaseAdmin
    .from('orders')
    .update(update)
    .eq('shopify_order_id', order.shopify_order_id);
  if (error) console.error(`applyGelatoToOrder(${order.shopify_order_id}) failed:`, error);
}

/** Refresh a single order's Gelato status (used after an approve). */
export async function refreshOrderGelatoStatus(orderId: string): Promise<void> {
  const order = await getOrderById(orderId);
  if (!order?.gelato_order_id) return;
  const g = await getGelatoOrder(order.gelato_order_id);
  if (g) await applyGelatoToOrder(order, g);
}

// ────────────────────────────────────────────────────────────────
// Reconcile + sync (order_sync cron).
// ────────────────────────────────────────────────────────────────

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = '2024-10';

/** Pull the most recent Shopify orders and upsert them. Backfills anything the webhook missed. */
async function reconcileRecentShopifyOrders(limit = 50): Promise<number> {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    console.warn('[order_sync] Shopify admin env missing, skipping reconcile');
    return 0;
  }
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=${limit}&order=created_at+desc`;
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN } });
  if (!res.ok) {
    console.error(`[order_sync] Shopify orders ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return 0;
  }
  const body = (await res.json()) as { orders?: ShopifyOrderInput[] };
  let count = 0;
  for (const o of body.orders ?? []) {
    const r = await upsertOrderFromShopify(o);
    if (r.ok) count++;
  }
  return count;
}

/**
 * Match Gelato orders to our order rows by Shopify external id and copy
 * status/cost/preview across. One search call covers all recent orders.
 */
async function syncGelatoStatuses(): Promise<number> {
  const gelatoOrders = await listGelatoOrdersDetailed(100);
  const byExternalId = new Map<string, GelatoOrderSummary>();
  for (const g of gelatoOrders) {
    if (g.externalOrderId) byExternalId.set(String(g.externalOrderId), g);
  }
  if (byExternalId.size === 0) return 0;

  const orders = await getOrders();
  let count = 0;
  for (const o of orders) {
    // Skip orders already in a terminal Gelato state to save writes.
    if (o.gelato_fulfillment_status === 'shipped' || o.gelato_fulfillment_status === 'canceled') {
      continue;
    }
    const g = byExternalId.get(o.shopify_order_id);
    if (!g) continue;
    await applyGelatoToOrder(o, g);
    count++;
  }
  return count;
}

export async function runOrderSync(): Promise<{ reconciled: number; gelatoSynced: number }> {
  const reconciled = await reconcileRecentShopifyOrders();
  const gelatoSynced = await syncGelatoStatuses();
  return { reconciled, gelatoSynced };
}
