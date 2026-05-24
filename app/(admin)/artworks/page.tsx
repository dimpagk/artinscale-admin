import Link from 'next/link';
import { getArtworks } from '@/lib/artworks';
import {
  PageHeader,
  DataTable,
  EmptyState,
  ImageThumb,
  StatusBadge,
  SyncDot,
  type DataTableColumn,
} from '@/components/admin-ui';
import type { ArtworkWithJoins } from '@/lib/artworks';

export default async function ArtworksPage() {
  const artworks = await getArtworks();

  const columns: DataTableColumn<ArtworkWithJoins>[] = [
    {
      key: 'artwork',
      header: 'Artwork',
      render: (a) => (
        <div className="flex items-center gap-3">
          <ImageThumb src={a.image_url} alt={a.title} />
          <div>
            <p className="font-medium text-gray-900">{a.title}</p>
            <p className="text-xs text-gray-500">
              {a.price != null ? `${a.currency} ${a.price}` : 'No price'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'artist',
      header: 'Artist',
      render: (a) => <span className="text-gray-600">{a.users?.name || '—'}</span>,
    },
    {
      key: 'topic',
      header: 'Topic',
      render: (a) => <span className="text-gray-600">{a.topics?.title || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <StatusBadge domain="artwork" status={a.status} />,
    },
    {
      key: 'edition',
      header: 'Edition',
      render: (a) => (
        <span className="text-gray-600">
          {a.edition_size != null
            ? `${a.edition_sold} / ${a.edition_size}`
            : '—'}
        </span>
      ),
    },
    {
      key: 'product_type',
      header: 'Type',
      render: (a) => <span className="text-gray-600">{a.product_type || '—'}</span>,
    },
    {
      key: 'integrations',
      header: 'Integrations',
      render: (a) => (
        <div className="flex items-center gap-2">
          <SyncDot connected={!!a.gelato_product_id} label="Gelato" />
          <span className="text-xs text-gray-500">G</span>
          <SyncDot connected={!!a.shopify_handle} label="Shopify" />
          <span className="text-xs text-gray-500">S</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (a) => (
        <Link
          href={`/artworks/${a.id}`}
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          Edit
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Artworks"
        action={{ href: '/artworks/new', label: 'New Artwork' }}
      />
      <DataTable
        rows={artworks}
        columns={columns}
        rowKey={(a) => a.id}
        emptyState={
          <EmptyState
            title="No artworks yet"
            description="Generate your first piece in AI Art, then create the artwork record here."
            action={{ href: '/artworks/new', label: 'New Artwork' }}
          />
        }
      />
    </div>
  );
}

