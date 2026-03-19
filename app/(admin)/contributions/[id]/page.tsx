import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContributionById } from '@/lib/contributions';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ContributionActions } from '@/components/contributions/contribution-actions';

const statusVariant = {
  pending: 'warning' as const,
  approved: 'success' as const,
  rejected: 'error' as const,
};

export default async function ContributionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contribution = await getContributionById(id);

  if (!contribution) return notFound();

  const isMedia = contribution.type === 'photo' || contribution.type === 'sound' || contribution.type === 'link';

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link
          href="/contributions"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to contributions
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Contribution Review</h1>
        <Badge variant={statusVariant[contribution.status]}>{contribution.status}</Badge>
        <Badge variant="outline">{contribution.type}</Badge>
      </div>

      <div className="space-y-4">
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Contributor</h2>
          <div className="space-y-1 text-sm">
            <p><span className="text-gray-500">Name:</span> {contribution.contributor_name}</p>
            <p><span className="text-gray-500">Email:</span> {contribution.contributor_email}</p>
            {contribution.contributor_location && (
              <p><span className="text-gray-500">Location:</span> {contribution.contributor_location}</p>
            )}
            <p><span className="text-gray-500">Topic:</span> {contribution.topic_id}</p>
            <p><span className="text-gray-500">Submitted:</span> {new Date(contribution.created_at).toLocaleString()}</p>
            <p><span className="text-gray-500">Public:</span> {contribution.show_publicly ? 'Yes' : 'No'}</p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Content</h2>
          {contribution.type === 'story' ? (
            <div className="whitespace-pre-wrap text-sm text-gray-800">{contribution.content}</div>
          ) : (
            <div className="space-y-2">
              {contribution.type === 'photo' && contribution.content.startsWith('http') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contribution.content}
                  alt="Contribution"
                  className="max-h-96 rounded-lg object-contain"
                />
              ) : (
                <a
                  href={contribution.content}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 underline break-all"
                >
                  {contribution.content}
                </a>
              )}
              {contribution.caption && (
                <p className="text-sm text-gray-600 italic">{contribution.caption}</p>
              )}
            </div>
          )}
        </Card>

        {contribution.admin_notes && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Admin Notes</h2>
            <p className="text-sm text-gray-700">{contribution.admin_notes}</p>
          </Card>
        )}

        {contribution.status === 'pending' && (
          <ContributionActions contributionId={contribution.id} />
        )}
      </div>
    </div>
  );
}
