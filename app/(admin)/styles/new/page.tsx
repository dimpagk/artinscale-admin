import { getArtists } from '@/lib/users'
import { listStylePacksAsync } from '@/lib/style-packs/server'
import { PageHeader, BackLink } from '@/components/admin-ui'
import { NewPackForm } from './new-pack-form'

export default async function NewStylePackPage({
  searchParams,
}: {
  searchParams: Promise<{ artist?: string }>
}) {
  const params = await searchParams
  const [artists, allPacks] = await Promise.all([
    getArtists(),
    listStylePacksAsync(),
  ])

  // Build the "which artists already have a pack" map so the form can
  // gray out artists that already own one.
  const ownedArtistIds = new Set(allPacks.map((p) => p.persona.userId))
  const artistOptions = artists.map((a) => ({
    id: a.id,
    name: a.name ?? '',
    email: a.email,
    hasPack: ownedArtistIds.has(a.id),
  }))

  // Templates are existing packs the operator can copy from
  const templateOptions = allPacks.map((p) => ({
    id: p.id,
    label: `${p.persona.name} (${p.id})`,
  }))

  return (
    <div className="max-w-3xl">
      <BackLink href={params.artist ? `/artists/${params.artist}` : '/styles'}>
        {params.artist ? 'Back to artist' : 'All style packs'}
      </BackLink>
      <PageHeader
        title="Create a style pack"
        description="Step 1 of 2 — set the basics, then customize prompt, palette and composition on the next page."
      />
      <NewPackForm
        artists={artistOptions}
        defaultArtistId={params.artist}
        templateOptions={templateOptions}
      />
    </div>
  )
}
