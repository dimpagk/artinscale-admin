import Link from 'next/link';
import { getArtists } from '@/lib/users';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default async function ArtistsPage() {
  const artists = await getArtists();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Artists</h1>
        <Link href="/artists/new">
          <Button>Add Artist</Button>
        </Link>
      </div>

      <Card padding="none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Portfolio</th>
              <th className="px-6 py-3 font-medium">Created</th>
              <th className="px-6 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {artists.map((artist) => (
              <tr key={artist.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <p className="text-sm font-medium text-gray-900">
                    {artist.name || 'Unnamed'}
                  </p>
                  {artist.bio && (
                    <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{artist.bio}</p>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{artist.email}</td>
                <td className="px-6 py-4">
                  {artist.portfolio ? (
                    <a
                      href={artist.portfolio}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline"
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(artist.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <Link
                    href={`/artists/${artist.id}`}
                    className="text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {artists.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                  No artists yet. Add your first artist.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
