import Link from 'next/link';
import { notFound } from 'next/navigation';
/* eslint-disable @next/next/no-img-element */
import { PageHeader, RelativeTime } from '@/components/admin-ui';
import { getOrderById, orderNeedsApproval } from '@/lib/orders';
import { getOrderEconomics } from '@/lib/costs/economics';
import { approveOrderAction } from '../actions';
import { ApproveButton } from '../approve-button';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

function money(amount: number | null | undefined, currency = 'EUR'): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
}

function shopifyAdminOrderUrl(shopifyOrderId: string): string | null {
  if (!SHOPIFY_DOMAIN) return null;
  const store = SHOPIFY_DOMAIN.replace('.myshopify.com', '');
  return `https://${store}.myshopify.com/admin/orders/${shopifyOrderId}`;
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [order, econ] = await Promise.all([getOrderById(id), getOrderEconomics(id)]);
  if (!order) notFound();

  const needsApproval = orderNeedsApproval(order);
  const adminUrl = shopifyAdminOrderUrl(order.shopify_order_id);
  const ship = order.shipping_address;
  const m = econ?.contribution_margin ?? null;
  const marginPct =
    econ && econ.contribution_margin != null && econ.gross_revenue > 0
      ? (econ.contribution_margin / econ.gross_revenue) * 100
      : null;

  return (
    <div>
      <Link href="/orders" className="mb-3 inline-block text-sm text-gray-500 hover:text-gray-900">
        ← Orders
      </Link>
      <PageHeader
        title={order.name ?? `#${order.shopify_order_number ?? order.shopify_order_id}`}
        description={`Placed ${order.placed_at ? new Date(order.placed_at).toLocaleString('en-IE') : 'recently'}`}
      />

      {needsApproval && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-amber-900">This order is waiting for your approval</p>
            <p className="text-sm text-amber-800">
              Approving sends it to Gelato for production. Gelato cost{' '}
              {money(order.gelato_item_cost, order.currency)}, your margin {money(m, order.currency)}.
            </p>
          </div>
          <ApproveButton
            action={approveOrderAction.bind(null, order.id)}
            confirmText={`Approve ${order.name ?? 'this order'} and send it to production? This charges ${money(
              order.gelato_item_cost,
              order.currency
            )} and ships to the customer.`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: items + preview */}
        <div className="space-y-6 lg:col-span-2">
          <Card title="Items">
            <ul className="divide-y divide-gray-100">
              {order.line_items.map((li, i) => (
                <li key={i} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">{li.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      {li.variant_title ? `${li.variant_title} · ` : ''}Qty {li.quantity}
                    </p>
                  </div>
                  <p className="text-sm text-gray-700">{money(li.price, order.currency)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
              <Row label="Subtotal" value={money(order.subtotal_price, order.currency)} />
              {!!order.total_discounts && (
                <Row label="Discounts" value={`- ${money(order.total_discounts, order.currency)}`} muted />
              )}
              <Row label="Shipping charged" value={money(order.shipping_price, order.currency)} />
              {order.total_tax != null && (
                <Row
                  label={`VAT / tax${order.taxes_included ? ' (incl.)' : ''}`}
                  value={money(order.total_tax, order.currency)}
                  muted
                />
              )}
              <Row label="Total" value={money(order.total_price, order.currency)} bold />
            </dl>
          </Card>

          <Card title="Unit economics">
            {econ ? (
              <dl className="space-y-1 text-sm">
                <Row
                  label="Net revenue (ex-VAT, less discounts)"
                  value={money(econ.net_revenue_ex_vat, order.currency)}
                />
                <Row label="+ Shipping charged" value={money(econ.shipping_charged, order.currency)} muted />
                <Row
                  label="− Production (Gelato)"
                  value={econ.production_cost == null ? 'not synced' : `- ${money(econ.production_cost, order.currency)}`}
                  muted
                />
                {econ.shipping_cost > 0 && (
                  <Row label="− Gelato shipping" value={`- ${money(econ.shipping_cost, order.currency)}`} muted />
                )}
                <Row label="− Payment fee (est.)" value={`- ${money(econ.payment_fee, order.currency)}`} muted />
                {econ.artist_royalty > 0 && (
                  <Row label="− Artist royalty" value={`- ${money(econ.artist_royalty, order.currency)}`} muted />
                )}
                <div className="mt-2 border-t border-gray-100 pt-2">
                  <Row
                    label="Contribution margin"
                    value={
                      m == null
                        ? 'pending production sync'
                        : `${money(m, order.currency)}${marginPct != null ? ` · ${marginPct.toFixed(0)}%` : ''}`
                    }
                    bold
                  />
                </div>
                <p className="pt-2 text-xs text-gray-400">
                  Contribution margin is per-order and excludes the artwork&apos;s one-time creation
                  cost, which is amortised across all its sales (see the piece on the Economics page).
                </p>
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Economics unavailable for this order.</p>
            )}
          </Card>

          {order.gelato_preview_url && (
            <Card title="Print preview">
              <p className="mb-3 text-xs text-gray-500">
                Gelato&apos;s render of the file that will be printed. Check it looks sharp before approving.
              </p>
              <img
                src={order.gelato_preview_url}
                alt="Gelato print preview"
                className="max-h-96 w-auto rounded-lg border border-gray-200"
              />
            </Card>
          )}
        </div>

        {/* Right: statuses + customer */}
        <div className="space-y-6">
          <Card title="Status">
            <dl className="space-y-2 text-sm">
              <Row label="Payment" value={order.financial_status ?? 'unknown'} />
              <Row label="Shopify fulfillment" value={order.shopify_fulfillment_status ?? 'unfulfilled'} />
              <Row
                label="Gelato"
                value={order.gelato_fulfillment_status?.replace(/_/g, ' ') ?? 'not linked'}
              />
              {order.gelato_synced_at && (
                <Row
                  label="Synced"
                  value={<RelativeTime date={order.gelato_synced_at} />}
                  muted
                />
              )}
            </dl>
            <div className="mt-4 flex flex-col gap-2">
              {adminUrl && (
                <a href={adminUrl} target="_blank" rel="noreferrer" className="text-sm text-gray-600 hover:text-gray-900">
                  Open in Shopify ↗
                </a>
              )}
              {order.gelato_tracking_url && (
                <a
                  href={order.gelato_tracking_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Track shipment ↗
                </a>
              )}
            </div>
          </Card>

          <Card title="Customer">
            <p className="text-sm font-medium text-gray-900">{order.customer_name ?? '—'}</p>
            {order.customer_email && <p className="text-sm text-gray-600">{order.customer_email}</p>}
            {ship && (
              <address className="mt-3 not-italic text-sm text-gray-600">
                {ship.address1 && <div>{ship.address1}</div>}
                {ship.address2 && <div>{ship.address2}</div>}
                <div>
                  {[ship.city, ship.zip].filter(Boolean).join(' ')}
                </div>
                <div>{[ship.province, ship.country_code].filter(Boolean).join(', ')}</div>
              </address>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? 'text-gray-400' : 'text-gray-500'}>{label}</dt>
      <dd className={bold ? 'font-semibold text-gray-900' : muted ? 'text-gray-500' : 'text-gray-700'}>
        {value}
      </dd>
    </div>
  );
}
