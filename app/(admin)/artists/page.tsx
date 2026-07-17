import Link from 'next/link';
import { listArtists } from '@/lib/users';
import { listStylePacksAsync } from '@/lib/style-packs/server';
import { Badge } from '@/components/ui/badge';
import {
  PageHeader,
  DataTable,
  EmptyState,
  TableFilters,
  Pagination,
  type DataTableColumn,
} from '@/components/admin-ui';
import type { ArtistKind, User } from '@/lib/types';

// Label + badge style per artist kind. Distinct, low-key variants so the
// three groups are scannable without shouting.
const ARTIST_KIND_BADGE: Record<
  ArtistKind,
  { label: string; variant: 'secondary' | 'success' | 'outline' }
> = {
  studio: { label: 'Studio', variant: 'secondary' },
  community: { label: 'Community', variant: 'success' },
  classic: { label: 'Classic', variant: 'outline' },
};

const PAGE_SIZE = 20;

const KIND_OPTIONS = [
  { value: 'studio', label: 'Studio' },
  { value: 'community', label: 'Community' },
  { value: 'classic', label: 'Classic' },
];

interface ArtistRow extends User {
  stylePackName: string | null;
  stylePackId: string | null;
  variantCount: number;
}

export default async function ArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    kind?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const dir = params.dir === 'desc' ? 'desc' : 'asc';
  const q = params.q || undefined;
  const kind = KIND_OPTIONS.some((k) => k.value === params.kind)
    ? (params.kind as ArtistKind)
    : undefined;
  const hasFilters = !!q || !!kind;

  const [{ rows: artists, total, page: effectivePage }, stylePacks] = await Promise.all([
    listArtists({ q, kind, sort: params.sort, dir, page, pageSize: PAGE_SIZE }),
    listStylePacksAsync(),
  ]);

  // Multi-pack model — group all packs by artist, then pick the primary
  // for the row's main display + count the variants.
  const packsByArtist = new Map<string, typeof stylePacks>();
  for (const pack of stylePacks) {
    const existing = packsByArtist.get(pack.persona.userId) ?? [];
    existing.push(pack);
    packsByArtist.set(pack.persona.userId, existing);
  }

  const rows: ArtistRow[] = artists.map((a) => {
    const owned = packsByArtist.get(a.id) ?? [];
    const primary = owned.find((p) => p.isPrimary !== false) ?? owned[0] ?? null;
    return {
      ...a,
      stylePackName: primary?.persona.name ?? null,
      stylePackId: primary?.id ?? null,
      variantCount: Math.max(0, owned.length - 1),
    };
  });

  const columns: DataTableColumn<ArtistRow>[] = [
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      render: (a) => {
        const kindBadge = a.artist_kind ? ARTIST_KIND_BADGE[a.artist_kind] : null;
        return (
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-gray-900">{a.name || 'Unnamed'}</p>
              {kindBadge && (
                <Badge variant={kindBadge.variant} size="sm">
                  {kindBadge.label}
                </Badge>
              )}
            </div>
            {a.bio && (
              <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{a.bio}</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'style',
      header: 'Style',
      render: (a) =>
        a.stylePackId ? (
          <Link
            href={`/styles/${a.stylePackId}`}
            className="inline-flex items-center gap-1.5"
            title={a.stylePackId}
          >
            <Badge variant="outline" size="sm">
              {prettifyStyleLabel(a.stylePackId)}
            </Badge>
            {a.variantCount > 0 && (
              <span className="text-xs text-gray-400">+{a.variantCount}</span>
            )}
          </Link>
        ) : (
          <span className="text-gray-400">— none</span>
        ),
    },
    {
      key: 'email',
      header: 'Email',
      sortKey: 'email',
      render: (a) => <span className="text-gray-600">{a.email}</span>,
    },
    {
      key: 'portfolio',
      header: 'Portfolio',
      render: (a) =>
        a.portfolio ? (
          <a
            href={a.portfolio}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            View
          </a>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      key: 'created',
      header: 'Created',
      sortKey: 'created',
      render: (a) => (
        <span className="text-gray-500">
          {new Date(a.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (a) => (
        <Link
          href={`/artists/${a.id}`}
          className="font-medium text-gray-600 hover:text-gray-900"
        >
          Edit
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Artists"
        action={{ href: '/artists/new', label: 'Add Artist' }}
      />
      <TableFilters
        searchPlaceholder="Search name, email, or bio"
        selects={[{ param: 'kind', allLabel: 'All kinds', options: KIND_OPTIONS }]}
      />
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(a) => a.id}
        sort={{
          key: params.sort,
          dir,
          basePath: '/artists',
          params: { q: params.q, kind: params.kind },
        }}
        emptyState={
          hasFilters ? (
            <EmptyState
              title="No matching artists"
              description="No artists match the current search and filters."
            />
          ) : (
            <EmptyState
              title="No artists yet"
              description="Real artists or AI-augmented personas live here. The launch collection's three personas are seeded via migration 009; their style packs come from migration 013."
              action={{ href: '/artists/new', label: 'Add Artist' }}
            />
          )
        }
      />
      <Pagination
        page={effectivePage}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/artists"
        params={{
          q: params.q,
          kind: params.kind,
          sort: params.sort,
          dir: params.sort ? dir : undefined,
        }}
      />
    </div>
  );
}

/**
 * Display a friendly short label for a style pack id.
 *   risograph-pulse   → "Risograph"
 *   linework-meridian → "Linework"
 *   bauhaus-prime     → "Bauhaus"
 * Falls back to the full id if the kebab structure is unusual.
 */
function prettifyStyleLabel(stylePackId: string): string {
  const first = stylePackId.split('-')[0];
  if (!first) return stylePackId;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
