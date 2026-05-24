import Link from 'next/link'
import { listStylePacksAsync } from '@/lib/style-packs/server'
import { PageHeader, EmptyState } from '@/components/admin-ui'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

/**
 * Style pack list — every "AI artist" persona that drives generation.
 * Click into one to edit master prompt, palette, persona bio, etc.
 *
 * Source of truth: DB row in `style_packs` if present; else the bundled
 * JSON file in `lib/style-packs/`. Migration 013 seeds the 3 launch
 * packs into the DB so they're editable from this page.
 */
export default async function StylePacksPage() {
  const packs = await listStylePacksAsync()

  if (packs.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Style Packs"
          description="No style packs found. Run migration 013 to seed the launch packs."
        />
        <EmptyState
          title="No style packs"
          description="Style packs back the 'AI artist' personas that drive every generation. The 3 launch packs are seeded by migration 013."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Style Packs"
        description={`${packs.length} AI artist personas. Each one locks a prompt, palette, composition, and voice. Click to edit.`}
        action={{ href: '/styles/new', label: 'New Style Pack' }}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => (
          <Link key={pack.id} href={`/styles/${pack.id}`} className="block">
            <Card>
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">{pack.persona.name}</h3>
                    <p className="text-xs italic text-gray-500">{pack.persona.tagline}</p>
                  </div>
                  {pack.enabledForLaunch ? (
                    <Badge variant="success" size="sm">Launch</Badge>
                  ) : (
                    <Badge variant="secondary" size="sm">Draft</Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {pack.palette.colors.slice(0, 6).map((c) => (
                    <span
                      key={c}
                      className="h-5 w-5 rounded-full border border-gray-200"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>

                <p className="line-clamp-3 text-xs text-gray-600">
                  {pack.persona.bioMd}
                </p>

                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <Badge variant="outline" size="sm">
                    {pack.composition.aspectRatios.join(' · ')}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    ≤{pack.composition.maxSubjects} subject{pack.composition.maxSubjects === 1 ? '' : 's'}
                  </Badge>
                  {pack.vectorizesWell && (
                    <Badge variant="outline" size="sm">vectorizes well</Badge>
                  )}
                </div>

                <p className="text-xs text-gray-400">id: <code className="font-mono">{pack.id}</code></p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
