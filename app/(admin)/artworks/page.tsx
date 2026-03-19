import Link from 'next/link';
import { getArtworks } from '@/lib/artworks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const statusVariant = {
  created: 'warning' as const,
  listed: 'success' as const,
  sold: 'secondary' as const,
};

export default async function ArtworksPage() {
  const artworks = await getArtworks();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Artworks</h1>
        <Link href="/artworks/new">
          <Button>New Artwork</Button>
        </Link>
      </div>

      <Card padding="none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
              <th className="px-6 py-3 font-medium">Artwork</th>
              <th className="px-6 py-3 font-medium">Artist</th>
              <th className="px-6 py-3 font-medium">Topic</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Edition</th>
              <th className="px-6 py-3 font-medium">Type</th>
              <th className="px-6 py-3 font-medium">Integrations</th>
              <th className="px-6 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {artworks.map((artwork) => (
              <tr key={artwork.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {artwork.image_url ? (
                      <img
                        src={artwork.image_url}
                        alt={artwork.title}
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
                        No img
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-900">{artwork.title}</p>
                      <p className="text-xs text-gray-500">
                        {artwork.price != null
                          ? `${artwork.currency} ${artwork.price}`
                          : 'No price'}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {artwork.users?.name || '-'}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {artwork.topics?.title || '-'}
                </td>
                <td className="px-6 py-4">
                  <Badge variant={statusVariant[artwork.status]} size="sm">
                    {artwork.status}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {artwork.edition_size != null
                    ? `${artwork.edition_sold} / ${artwork.edition_size}`
                    : '-'}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {artwork.product_type || '-'}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${artwork.gelato_product_id ? 'bg-green-500' : 'bg-gray-300'}`}
                      title={artwork.gelato_product_id ? 'Gelato synced' : 'Gelato not synced'}
                    />
                    <span className="text-xs text-gray-500">G</span>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${artwork.shopify_handle ? 'bg-green-500' : 'bg-gray-300'}`}
                      title={artwork.shopify_handle ? 'Shopify synced' : 'Shopify not synced'}
                    />
                    <span className="text-xs text-gray-500">S</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <Link
                    href={`/artworks/${artwork.id}`}
                    className="text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {artworks.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                  No artworks yet. Create your first artwork.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
