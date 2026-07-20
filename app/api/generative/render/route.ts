import { NextRequest, NextResponse } from 'next/server'
import { findSystem } from '@/lib/generative/registry'
import { renderCached, systemDir, type RenderKind } from '@/lib/generative/server'

// Renders one seed of a generative system by shelling out to the system's
// node/render.js, content-addressed cached. Auth is enforced by middleware
// like every admin route.

export const dynamic = 'force-dynamic'
// Print masters are 40x50cm at 300dpi; a slow seed can take minutes.
export const maxDuration = 600

const KINDS: RenderKind[] = ['thumb', 'preview', 'master']

export async function POST(request: NextRequest) {
  let body: {
    system?: string
    seed?: number
    kind?: string
    params?: Record<string, unknown>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const system = String(body.system ?? '')
  if (!findSystem(system)) {
    return NextResponse.json({ error: `Unknown system "${system}"` }, { status: 404 })
  }
  const kind = (body.kind ?? 'thumb') as RenderKind
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: `Unknown kind "${body.kind}"` }, { status: 400 })
  }
  const seed = Number(body.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 99_999_999) {
    return NextResponse.json({ error: 'seed must be an integer in 0..99999999' }, { status: 400 })
  }
  if (!systemDir(system)) {
    return NextResponse.json(
      {
        error:
          'Renderer offline: the generative/ workspace folder is not reachable from this deployment. Run the admin locally next to the workspace repo (or set GENERATIVE_ROOT).',
      },
      { status: 503 }
    )
  }

  try {
    const result = await renderCached({ system, kind, seed, params: body.params ?? {} })
    const url = `/api/generative/file?system=${encodeURIComponent(system)}&f=${encodeURIComponent(result.relPath)}`
    return NextResponse.json({ url, relPath: result.relPath, cached: result.cached })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'render failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
