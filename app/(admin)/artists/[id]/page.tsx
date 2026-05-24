import { notFound } from 'next/navigation';
import { getUserById } from '@/lib/users';
import { listStylePacksByArtistAsync } from '@/lib/style-packs/server';
import { ArtistForm } from '@/components/artists/artist-form';
import { ButtonLink } from '@dimpagk/artinscale-ui/navigation';
import {
  PageHeader,
  PageMeta,
  BackLink,
  FormCard,
  Field,
  FieldList,
} from '@/components/admin-ui';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SetPrimaryButton } from './set-primary-button';

export default async function EditArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [artist, packs] = await Promise.all([
    getUserById(id),
    listStylePacksByArtistAsync(id),
  ]);

  if (!artist || artist.role !== 'ARTIST') return notFound();

  const primaryPack = packs.find((p) => p.isPrimary !== false) ?? packs[0] ?? null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href="/artists">All artists</BackLink>
        <PageHeader title={`Edit: ${artist.name || artist.email}`} />
        <PageMeta
          items={[
            artist.email,
            primaryPack && (
              <>
                Style:{' '}
                <span className="text-gray-900">{primaryPack.persona.name}</span>
                {packs.length > 1 && (
                  <span className="ml-1 text-gray-400">
                    +{packs.length - 1} variant{packs.length - 1 === 1 ? '' : 's'}
                  </span>
                )}
              </>
            ),
            artist.portfolio && (
              <a
                href={artist.portfolio}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-700 hover:text-gray-900 hover:underline"
              >
                Portfolio ↗
              </a>
            ),
          ]}
        />
      </div>

      <ArtistForm artist={artist} />

      <FormCard
        title="Visual voice"
        description={
          packs.length > 1
            ? 'Multiple style packs are linked to this artist. The primary pack drives downstream agents (drop campaigns, comment replies, email drops).'
            : "The style pack that defines this artist's prompt, palette, and composition rules."
        }
        action={
          packs.length > 0 ? (
            <ButtonLink
              href={`/styles/new?artist=${id}`}
              variant="secondary"
              size="sm"
            >
              + Add variant
            </ButtonLink>
          ) : undefined
        }
      >
        {packs.length === 0 ? (
          <Card tone="muted" padding="md">
            <p className="text-sm text-gray-600">
              No style pack assigned to this artist yet. Until one is linked,
              the AI Art Generator can&apos;t generate in this artist&apos;s
              voice and downstream agents (drop campaigns, comment replies,
              email drops) will fall back to the platform brand voice.
            </p>
            <div className="mt-3">
              <ButtonLink
                href={`/styles/new?artist=${id}`}
                variant="primary"
                size="sm"
              >
                Create style pack
              </ButtonLink>
            </div>
          </Card>
        ) : (
          <ul className="-mx-2 space-y-1">
            {packs.map((pack) => (
              <PackRow key={pack.id} artistId={id} pack={pack} />
            ))}
          </ul>
        )}
      </FormCard>
    </div>
  );
}

interface PackRowProps {
  artistId: string;
  pack: Awaited<ReturnType<typeof listStylePacksByArtistAsync>>[number];
}

function PackRow({ artistId, pack }: PackRowProps) {
  const isPrimary = pack.isPrimary !== false;

  return (
    <li
      className={`group flex items-center justify-between gap-4 rounded-md px-3 py-2.5 transition-colors hover:bg-gray-50 ${
        isPrimary ? 'bg-brand-coral/5' : ''
      }`.trim()}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="flex shrink-0 items-center gap-1">
          {pack.palette.colors.slice(0, 5).map((color) => (
            <span
              key={color}
              className="inline-block h-4 w-4 rounded-full border border-gray-200"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-gray-900">
              {pack.persona.name}
            </h3>
            {isPrimary && (
              <Badge variant="success" size="sm">
                Primary
              </Badge>
            )}
            {pack.enabledForLaunch && (
              <Badge variant="warning" size="sm">
                Launch
              </Badge>
            )}
          </div>
          <p className="truncate text-xs italic text-gray-500">
            {pack.persona.tagline}
          </p>
        </div>

        <FieldList columns={1} className="hidden lg:block lg:w-44 lg:shrink-0">
          <Field label="Ratios" value={pack.composition.aspectRatios.join(', ')} />
          <Field
            label="Subjects"
            value={`≤ ${pack.composition.maxSubjects}`}
          />
        </FieldList>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!isPrimary && <SetPrimaryButton artistId={artistId} packId={pack.id} />}
        <ButtonLink href={`/styles/${pack.id}`} variant="ghost" size="sm">
          Edit
        </ButtonLink>
      </div>
    </li>
  );
}
