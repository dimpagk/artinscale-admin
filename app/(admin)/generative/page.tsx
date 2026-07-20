import Link from 'next/link'
import { PageHeader } from '@/components/admin-ui'
import { Badge } from '@/components/ui/badge'
import { GENERATIVE_ARTISTS } from '@/lib/generative/registry'
import { systemDir } from '@/lib/generative/server'
import { promotedCounts } from '@/lib/generative/promote'
import { SeedImage } from '@/components/generative/seed-image'

export const dynamic = 'force-dynamic'

/**
 * Generative: the studio's deterministic drawing systems, grouped by the
 * artist who owns them. Each card opens a seed browser backed by the
 * system's own headless renderer; nothing here touches AI generation.
 */
export default async function GenerativePage() {
  const counts = await promotedCounts()
  const artists = GENERATIVE_ARTISTS.map((artist) => ({
    ...artist,
    systems: artist.systems.map((s) => ({
      ...s,
      available: !!systemDir(s.id),
      promoted: counts[s.id] ?? 0,
    })),
  }))
  const offline = artists.every((a) => a.systems.every((s) => !s.available))

  return (
    <div className="space-y-8">
      <PageHeader
        title="Generative"
        description="Deterministic drawing systems, one folder per system in the workspace repo. Browse seeds, tune parameters, render print masters. Selection is the work: same seed, same piece, forever."
      />

      {offline && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Renderer offline: the generative/ workspace folder is not reachable from this
          deployment. Run the admin locally next to the workspace repo (or set
          GENERATIVE_ROOT) to browse and render.
        </div>
      )}

      {artists.map((artist) => (
        <section key={artist.code}>
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-lg font-semibold text-gray-800">{artist.name}</h2>
            <span className="font-mono text-xs uppercase text-gray-400">{artist.code}</span>
            <span className="text-xs text-gray-400">
              {artist.systems.length} {artist.systems.length === 1 ? 'system' : 'systems'}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {artist.systems.map((system) => (
              <Link
                key={system.id}
                href={`/generative/${system.id}`}
                className="group overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
              >
                {system.available ? (
                  <SeedImage
                    system={system.id}
                    seed={1}
                    kind="thumb"
                    className="aspect-[4/5] w-full object-cover"
                    alt={`${system.title} S-000001`}
                  />
                ) : (
                  <div className="flex aspect-[4/5] w-full items-center justify-center bg-[#f1efe8] text-xs text-gray-400">
                    renderer offline
                  </div>
                )}
                <div className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-medium text-gray-800 group-hover:underline">
                      {system.title}
                    </h3>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">
                      {system.series}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-gray-500">{system.tagline}</p>
                  {system.promoted > 0 && (
                    <Badge variant="success" size="sm" className="mt-1.5">
                      {system.promoted} {system.promoted === 1 ? 'artpiece' : 'artpieces'}
                    </Badge>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
