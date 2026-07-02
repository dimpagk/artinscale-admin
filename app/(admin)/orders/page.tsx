import Link from 'next/link';
import {
  DataTable,
  EmptyState,
  PageHeader,
  RelativeTime,
  type DataTableColumn,
} from '@/components/admin-ui';
import { getOrders, orderNeedsApproval, type OrderRow } from '@/lib/orders';
import { syncOrdersAction } from './actions';

function money(amount: number | null, currency = 'EUR'): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
}

function OrderStatusPill({ order }: { order: OrderRow }) {
  const needsApproval = orderNeedsApproval(order);
  const status = order.gelato_fulfillment_status;

  let label: string;
  let color: string;
  if (needsApproval) {
    label = 'Needs approval';
    color = 'text-amber-800 bg-amber-50 border-amber-200';
  } else if (!order.gelato_order_id) {
    label = 'No Gelato order';
    color = 'text-gray-600 bg-gray-50 border-gray-200';
  } else if (status === 'shipped') {
    label = 'Shipped';
    color = 'text-green-700 bg-green-50 border-green-200';
  } else if (status === 'canceled') {
    label = 'Canceled';
    color = 'text-red-700 bg-red-50 border-red-200';
  } else {
    label = status ? status.replace(/_/g, ' ') : 'In production';
    color = 'text-blue-700 bg-blue-50 border-blue-200';
  }
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

function PaymentPill({ status }: { status: string | null }) {
  const paid = status === 'paid';
  const color = paid
    ? 'text-green-700 bg-green-50 border-green-200'
    : 'text-amber-800 bg-amber-50 border-amber-200';
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${color}`}>
      {status ?? 'unknown'}
    </span>
  );
}

export default async function OrdersPage() {
  const orders = await getOrders();

  const total = orders.length;
  const needsApproval = orders.filter(orderNeedsApproval).length;
  const shipped = orders.filter((o) => o.gelato_fulfillment_status === 'shipped').length;

  const columns: DataTableColumn<OrderRow>[] = [
    {
      key: 'order',
      header: 'Order',
      render: (o) => (
        <div>
          <Link href={`/orders/${o.id}`} className="font-medium text-gray-900 hover:underline">
            {o.name ?? `#${o.shopify_order_number ?? o.shopify_order_id}`}
          </Link>
          <p className="text-xs text-gray-500">
            <RelativeTime date={o.placed_at ?? o.created_at} />
          </p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (o) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-gray-700">{o.customer_name ?? '—'}</p>
          {o.customer_email && (
            <p className="truncate text-xs text-gray-500">{o.customer_email}</p>
          )}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (o) => {
        const first = o.line_items[0];
        const extra = o.line_items.length - 1;
        return (
          <div className="min-w-0">
            <p className="truncate text-sm text-gray-700">
              {first ? `${first.quantity} × ${first.title}` : '—'}
            </p>
            {extra > 0 && (
              <p className="text-xs text-gray-500">
                +{extra} more item{extra > 1 ? 's' : ''}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'total',
      header: 'Total',
      render: (o) => (
        <div>
          <p className="text-sm font-medium text-gray-900">{money(o.total_price, o.currency)}</p>
          {o.gelato_item_cost != null && o.subtotal_price != null && (
            <p className="text-xs text-gray-500">
              margin {money(o.subtotal_price - o.gelato_item_cost, o.currency)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'payment',
      header: 'Payment',
      render: (o) => <PaymentPill status={o.financial_status} />,
    },
    {
      key: 'fulfillment',
      header: 'Fulfillment',
      render: (o) => <OrderStatusPill order={o} />,
    },
    {
      key: 'actions',
      header: '',
      render: (o) => (
        <Link href={`/orders/${o.id}`} className="text-xs font-medium text-gray-500 hover:text-gray-900">
          View →
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every store order and its Gelato fulfillment, in one place. Approve prints without leaving the admin."
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Stat label="Total" value={total} />
        <Stat label="Needs approval" value={needsApproval} variant="warning" />
        <Stat label="Shipped" value={shipped} variant="success" />
        <form action={syncOrdersAction} className="ml-auto">
          <button
            type="submit"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Sync now
          </button>
        </form>
      </div>
      <DataTable
        rows={orders}
        columns={columns}
        rowKey={(o) => o.id}
        emptyState={
          <EmptyState
            title="No orders yet"
            description="Paid orders appear here automatically. If you expected one, press Sync now to reconcile with Shopify and Gelato."
          />
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'warning' | 'error';
}) {
  const color =
    variant === 'success'
      ? 'text-green-700 bg-green-50 border-green-200'
      : variant === 'warning'
        ? 'text-amber-700 bg-amber-50 border-amber-200'
        : variant === 'error'
          ? 'text-red-700 bg-red-50 border-red-200'
          : 'text-gray-700 bg-gray-50 border-gray-200';
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${color}`}>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="ml-1.5 text-xs">{label}</span>
    </div>
  );
}
