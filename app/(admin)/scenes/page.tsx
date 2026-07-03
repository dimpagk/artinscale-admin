import { PageHeader } from '@/components/admin-ui'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  MOCKUP_SCENES,
  MOCKUP_SCENES_BUCKET,
  sceneStoragePath,
} from '@/lib/mockup-scenes'
import { SceneLibrary, type SceneCard } from '@/components/scenes/scene-library'

// Storage status must reflect the latest local generation run.
export const dynamic = 'force-dynamic'

/**
 * Room Scenes: the pre-generated empty-room library used as backdrops
 * for the in-room product photo. Scenes are defined in code
 * (lib/mockup-scenes-catalog.mjs) and generated locally via
 * `node scripts/generate-mockup-scenes.mjs`; this page browses what has
 * landed in storage and flags catalog entries not generated yet.
 */
export default async function ScenesPage() {
  const { data: objects } = await supabaseAdmin.storage
    .from(MOCKUP_SCENES_BUCKET)
    .list('mockup-scenes', { limit: 1000 })
  const uploaded = new Set((objects ?? []).map((f) => f.name))

  const scenes: SceneCard[] = MOCKUP_SCENES.map((s) => {
    const path = sceneStoragePath(s.key)
    const { data } = supabaseAdmin.storage.from(MOCKUP_SCENES_BUCKET).getPublicUrl(path)
    return {
      key: s.key,
      room: s.room,
      aesthetic: s.aesthetic,
      city: s.location?.city ?? null,
      cityCode: s.location?.code ?? null,
      materials: s.materials ?? [],
      light: s.light ?? null,
      wallTarget: s.wallTarget,
      generated: uploaded.has(path.split('/').pop() as string),
      imageUrl: data.publicUrl,
    }
  })

  const generatedCount = scenes.filter((s) => s.generated).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Room Scenes"
        description={`Pre-generated empty-room backdrops for in-room product photos. ${generatedCount}/${scenes.length} generated. Add scenes in lib/mockup-scenes-catalog.mjs, then run scripts/generate-mockup-scenes.mjs locally.`}
      />
      <SceneLibrary scenes={scenes} />
    </div>
  )
}
