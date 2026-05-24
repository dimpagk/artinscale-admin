import { notFound } from 'next/navigation'
import { fetchStylePackFromDb } from '@/lib/style-packs/db'
import { getStylePack } from '@/lib/style-packs'
import { PageHeader, BackLink } from '@/components/admin-ui'
import { StylePackForm } from './style-pack-form'

export const dynamic = 'force-dynamic'

export default async function EditStylePackPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // DB row wins; JSON is the fallback for packs that haven't been
  // edited yet.
  const pack = (await fetchStylePackFromDb(id)) ?? getStylePack(id)
  if (!pack) return notFound()

  const fromDb = !!(await fetchStylePackFromDb(id))

  return (
    <div className="max-w-3xl">
      <BackLink href="/styles">All style packs</BackLink>
      <PageHeader
        title={`Edit: ${pack.persona.name}`}
        description={
          fromDb
            ? 'This pack has DB overrides. Saving will keep them up to date.'
            : 'No DB overrides yet — saving will create one and start overriding the JSON file.'
        }
      />
      <StylePackForm pack={pack} />
    </div>
  )
}
