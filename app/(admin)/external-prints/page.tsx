import {
  DataTable,
  EmptyState,
  ImageThumb,
  PageHeader,
  RelativeTime,
  StatusBadge,
  type DataTableColumn,
} from '@/components/admin-ui';
import {
  getExternalPrints,
  getExternalPrintsCountsByStatus,
  type ExternalPrintRow,
  type ExternalPrintStatus,
} from '@/lib/external-prints';
import { retireExternalPrintAction } from './actions';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

const STATUS_SHORT_LABEL: Record<ExternalPrintStatus, string> = {
  discovered: 'New',
  in_progress: 'Starting',
  fetching: 'Fetching',
  upscaling: 'Upscaling',
  rendering: 'Rendering',
  creating_gelato: 'Gelato',
  creating_shopify: 'Shopify',
  shopify_created: 'Ready',
  retired: 'Retired',
  error: 'Error',
};

function sourceLabel(source: string): string {
  switch (source) {
    case 'met':
      return 'The Met';
    case 'cleveland':
      return 'Cleveland';
    case 'aic':
      return 'Art Institute';
    case 'wikimedia':
      return 'Wikimedia';
    case 'europeana':
      return 'Europeana';
    case 'rijks':
      return 'Rijksmuseum';
    default:
      return source;
  }
}

function shopifyAdminProductUrl(productId: string | null): string | null {
  if (!productId || !SHOPIFY_DOMAIN) return null;
  // gid format: gid://shopify/Product/<id>
  const numeric = productId.split('/').pop();
  if (!numeric) return null;
  return `https://${SHOPIFY_DOMAIN.replace('.myshopify.com', '')}.myshopify.com/admin/products/${numeric}`;
}

export default async function ExternalPrintsPage() {
  const [prints, counts] = await Promise.all([
    getExternalPrints(),
    getExternalPrintsCountsByStatus(),
  ]);

  const totalCount = prints.length;
  const readyCount = counts.shopify_created ?? 0;
  const errorCount = counts.error ?? 0;
  const inFlightCount =
    (counts.in_progress ?? 0) +
    (counts.fetching ?? 0) +
    (counts.upscaling ?? 0) +
    (counts.rendering ?? 0) +
    (counts.creating_gelato ?? 0) +
    (counts.creating_shopify ?? 0);

  const columns: DataTableColumn<ExternalPrintRow>[] = [
    {
      key: 'piece',
      header: 'Piece',
      render: (p) => (
        <div className="flex items-center gap-3">
          <ImageThumb src={p.source_image_url} alt={p.title} />
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-900">{p.title}</p>
            <p className="truncate text-xs text-gray-500">
              {p.artist ?? 'Unknown artist'}
              {p.year_created ? ` · ${p.year_created}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (p) => (
        <div>
          <p className="text-sm text-gray-700">{sourceLabel(p.source)}</p>
          <p className="text-xs text-gray-500">{p.license}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <div>
          <StatusBadge
            domain="external_print"
            status={p.status}
            label={STATUS_SHORT_LABEL[p.status]}
          />
          {p.status === 'error' && p.error_message && (
            <p className="mt-1 max-w-xs truncate text-xs text-red-600" title={p.error_message}>
              {p.error_message}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'orders',
      header: 'Orders',
      render: (p) => (
        <div>
          <p className="text-sm text-gray-700">{p.order_count}</p>
          {p.last_ordered_at && (
            <p className="text-xs text-gray-500">
              last <RelativeTime date={p.last_ordered_at} />
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'commerce',
      header: 'Commerce',
      render: (p) => {
        const adminUrl = shopifyAdminProductUrl(p.shopify_product_id);
        if (!p.shopify_product_id) {
          return <span className="text-xs text-gray-400">—</span>;
        }
        return adminUrl ? (
          <a
            href={adminUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            View in Shopify ↗
          </a>
        ) : (
          <span className="text-xs text-gray-500">{p.shopify_handle}</span>
        );
      },
    },
    {
      key: 'created',
      header: 'Discovered',
      render: (p) => (
        <span className="text-xs text-gray-500">
          <RelativeTime date={p.created_at} />
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (p) =>
        p.status === 'retired' ? null : (
          <form action={retireExternalPrintAction.bind(null, p.id)}>
            <button
              type="submit"
              className="text-xs font-medium text-gray-500 hover:text-red-600"
            >
              Retire
            </button>
          </form>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="External prints"
        description="Public-domain pieces from museum federations, created on-demand when customers order them."
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <Stat label="Total" value={totalCount} />
        <Stat label="Ready" value={readyCount} variant="success" />
        <Stat label="In flight" value={inFlightCount} variant="warning" />
        <Stat label="Errored" value={errorCount} variant="error" />
      </div>
      <DataTable
        rows={prints}
        columns={columns}
        rowKey={(p) => p.id}
        emptyState={
          <EmptyState
            title="No external prints yet"
            description="When a customer requests a public-domain print from the ChatGPT App or storefront, the piece appears here as it moves through the on-demand pipeline."
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
