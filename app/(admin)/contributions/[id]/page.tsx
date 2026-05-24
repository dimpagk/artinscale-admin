import { notFound } from 'next/navigation';
import { getContributionById } from '@/lib/contributions';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  BackLink,
  EditPageLayout,
  Field,
  FieldList,
  PageHeader,
  SectionLabel,
  SidebarCard,
  StatusBadge,
} from '@/components/admin-ui';
import { ContributionActions } from '@/components/contributions/contribution-actions';

export default async function ContributionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contribution = await getContributionById(id);

  if (!contribution) return notFound();

  return (
    <div>
      <BackLink href="/contributions">All contributions</BackLink>

      <PageHeader
        title="Contribution Review"
        action={
          <div className="flex items-center gap-2">
            <StatusBadge domain="contribution" status={contribution.status} size="md" />
            <Badge variant="outline">{contribution.type}</Badge>
            {contribution.source === 'studio_seed' && (
              <Badge variant="outline" size="sm" className="border-violet-300 text-violet-600">
                seed
              </Badge>
            )}
          </div>
        }
      />

      <EditPageLayout
        main={
          <div className="space-y-4">
            <Card>
              <SectionLabel>Content</SectionLabel>
              {contribution.type === 'story' ? (
                <div className="whitespace-pre-wrap text-sm text-gray-800">
                  {contribution.content}
                </div>
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
                      className="break-all text-sm text-blue-600 underline"
                    >
                      {contribution.content}
                    </a>
                  )}
                  {contribution.caption && (
                    <p className="text-sm italic text-gray-600">{contribution.caption}</p>
                  )}
                </div>
              )}
            </Card>

            {contribution.admin_notes && (
              <Card>
                <SectionLabel>Admin Notes</SectionLabel>
                <p className="text-sm text-gray-700">{contribution.admin_notes}</p>
              </Card>
            )}
          </div>
        }
        sidebar={
          <>
            <SidebarCard title="Contributor">
              <FieldList columns={1}>
                <Field label="Name" value={contribution.contributor_name} />
                <Field label="Email" value={contribution.contributor_email} />
                {contribution.contributor_location && (
                  <Field label="Location" value={contribution.contributor_location} />
                )}
                <Field label="Topic" value={contribution.topic_id} />
                <Field
                  label="Submitted"
                  value={new Date(contribution.created_at).toLocaleDateString()}
                />
                <Field label="Public" value={contribution.show_publicly ? 'Yes' : 'No'} />
                <Field
                  label="Source"
                  value={contribution.source === 'studio_seed' ? 'Studio seed' : 'Community'}
                />
              </FieldList>
            </SidebarCard>

            {contribution.status === 'pending' && (
              <ContributionActions contributionId={contribution.id} />
            )}
          </>
        }
      />
    </div>
  );
}
