import { notFound } from 'next/navigation';
import { getArtworkById } from '@/lib/artworks';
import { getArtists } from '@/lib/users';
import { getAllTopics } from '@/lib/topics';
import { getPricingFinance, getPublishedPriceStatsBySize, getSizeMix } from '@/lib/pricing';
import { ArtworkForm } from '@/components/artworks/artwork-form';
import { ListingForm } from '@/components/artworks/listing-form';
import {
  BackLink,
  EditPageLayout,
  PageHeader,
  SidebarCard,
} from '@/components/admin-ui';

export default async function EditArtworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [artwork, artists, topicsWithStats, finance, sizePriceStats, sizeMix] = await Promise.all([
    getArtworkById(id),
    getArtists(),
    getAllTopics(),
    getPricingFinance(),
    getPublishedPriceStatsBySize(),
    getSizeMix(),
  ]);

  if (!artwork) return notFound();

  const topics = topicsWithStats.map((t) => ({ id: t.id, title: t.title }));
  const editionLabel =
    artwork.edition_size != null
      ? `${artwork.edition_sold} / ${artwork.edition_size}`
      : 'Open edition';

  return (
    <div>
      <BackLink href="/artworks">All artworks</BackLink>
      <PageHeader
        title={`Edit: ${artwork.title}`}
        badge={{ label: artwork.status, variant: artworkStatusVariant(artwork.status) }}
      />

      <EditPageLayout
        main={
          <ArtworkForm
            artwork={artwork}
            artists={artists.map((a) => ({ id: a.id, name: a.name || a.email }))}
            topics={topics}
            finance={finance}
            sizePriceStats={sizePriceStats}
            sizeMix={sizeMix}
          />
        }
        sidebar={
          <>
            {artwork.image_url && (
              <SidebarCard padding="sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artwork.image_url}
                  alt={artwork.title}
                  className="aspect-square w-full rounded-md object-cover"
                />
              </SidebarCard>
            )}

            <SidebarCard title="Details">
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Artist</dt>
                  <dd className="font-medium text-gray-900">
                    {artwork.users?.name || '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Topic</dt>
                  <dd className="font-medium text-gray-900">
                    {artwork.topics?.title || '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Edition</dt>
                  <dd className="font-medium text-gray-900">{editionLabel}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Price</dt>
                  <dd className="font-medium text-gray-900">
                    {artwork.price != null
                      ? `${artwork.currency} ${artwork.price}`
                      : '—'}
                  </dd>
                </div>
              </dl>
            </SidebarCard>

            <ListingForm
              artworkId={artwork.id}
              status={artwork.status}
              shopifyHandle={artwork.shopify_handle}
              shopifyProductId={artwork.shopify_product_id}
              hasTopic={!!artwork.topic_id}
            />
          </>
        }
      />
    </div>
  );
}

function artworkStatusVariant(status: 'created' | 'listed' | 'sold') {
  if (status === 'listed') return 'success' as const;
  if (status === 'sold') return 'secondary' as const;
  return 'warning' as const;
}
