import { notFound } from 'next/navigation'
import { PageHeader, BackLink } from '@/components/admin-ui'
import { findSystem } from '@/lib/generative/registry'
import { systemDir } from '@/lib/generative/server'
import { SystemBrowser } from '@/components/generative/system-browser'

export const dynamic = 'force-dynamic'

export default async function GenerativeSystemPage({
  params,
}: {
  params: Promise<{ system: string }>
}) {
  const { system: systemId } = await params
  const found = findSystem(systemId)
  if (!found) notFound()
  const { artist, system } = found
  const available = !!systemDir(system.id)

  return (
    <div className="space-y-6">
      <BackLink href="/generative">All systems</BackLink>
      <PageHeader
        title={`${system.title} · ${artist.name}`}
        description={`${system.series}. ${system.tagline} Studio: generative/${system.id}/viewer.html in the workspace repo; this browser drives the same headless renderer (node/render.js).`}
      />
      {available ? (
        <SystemBrowser system={system.id} title={system.title} paramSpecs={system.params} />
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Renderer offline: generative/{system.id}/node/render.js is not reachable from this
          deployment. Run the admin locally next to the workspace repo (or set GENERATIVE_ROOT).
        </div>
      )}
    </div>
  )
}
