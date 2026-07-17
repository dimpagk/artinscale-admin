import Link from 'next/link';
import { listArtworks, getArtworkProductTypes } from '@/lib/artworks';
import { getArtists } from '@/lib/users';
import { getAllTopics } from '@/lib/topics';
import {
  PageHeader,
  DataTable,
  EmptyState,
  ImageThumb,
  StatusBadge,
  SyncDot,
  TableFilters,
  Pagination,
  type DataTableColumn,
} from '@/components/admin-ui';
import type { ArtworkWithJoins } from '@/lib/artworks';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'created', label: 'Created' },
  { value: 'listed', label: 'Listed' },
  { value: 'sold', label: 'Sold' },
  { value: 'retired', label: 'Retired' },
];

export default async function ArtworksPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    artist?: string;
    topic?: string;
    type?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const filters = {
    q: params.q || undefined,
    status: params.status || undefined,
    artistId: params.artist || undefined,
    topicId: params.topic || undefined,
    productType: params.type || undefined,
  };
  const hasFilters = Object.values(filters).some(Boolean);

  const [{ rows: artworks, total, page: effectivePage }, artists, topics, productTypes] =
    await Promise.all([
      listArtworks({ ...filters, page, pageSize: PAGE_SIZE }),
      getArtists(),
      getAllTopics(),
      getArtworkProductTypes(),
    ]);

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
    <div className="space-y-4">
      <PageHeader
        title="Artworks"
        action={{ href: '/artworks/new', label: 'New Artwork' }}
      />
      <TableFilters
        searchPlaceholder="Search title or description"
        selects={[
          { param: 'status', allLabel: 'All statuses', options: STATUS_OPTIONS },
          {
            param: 'artist',
            allLabel: 'All artists',
            options: artists.map((a) => ({
              value: a.id,
              label: a.name || a.email,
            })),
          },
          {
            param: 'topic',
            allLabel: 'All topics',
            options: topics.map((t) => ({ value: t.id, label: t.title })),
          },
          {
            param: 'type',
            allLabel: 'All types',
            options: productTypes.map((t) => ({ value: t, label: t })),
          },
        ]}
      />
      <DataTable
        rows={artworks}
        columns={columns}
        rowKey={(a) => a.id}
        emptyState={
          hasFilters ? (
            <EmptyState
              title="No matching artworks"
              description="No artworks match the current search and filters."
            />
          ) : (
            <EmptyState
              title="No artworks yet"
              description="Generate your first piece in AI Art, then create the artwork record here."
              action={{ href: '/artworks/new', label: 'New Artwork' }}
            />
          )
        }
      />
      <Pagination
        page={effectivePage}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/artworks"
        params={{
          q: params.q,
          status: params.status,
          artist: params.artist,
          topic: params.topic,
          type: params.type,
        }}
      />
    </div>
  );
}
