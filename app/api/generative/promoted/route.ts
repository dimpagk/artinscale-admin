import { NextRequest, NextResponse } from 'next/server'
import { findSystem } from '@/lib/generative/registry'
import { promotedSeeds } from '@/lib/generative/promote'

// Which seeds of a system are already artpieces (artworks rows with
// generative provenance). The seed browser badges these.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const system = request.nextUrl.searchParams.get('system') ?? ''
  if (!findSystem(system)) {
    return NextResponse.json({ error: `Unknown system "${system}"` }, { status: 404 })
  }
  try {
    const result = await promotedSeeds(system)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lookup failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
