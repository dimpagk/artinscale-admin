import { NextRequest, NextResponse } from 'next/server'
import { findSystem } from '@/lib/generative/registry'
import { promoteSeed } from '@/lib/generative/promote'

// Turns a chosen seed into an artpiece: canonical master render, storage
// upload, artworks row with generative provenance. The operator continues on
// /artworks/[id] (Gelato push, listing, mockups). Admin-gated by middleware.

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function POST(request: NextRequest) {
  let body: { system?: string; seed?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const system = String(body.system ?? '')
  if (!findSystem(system)) {
    return NextResponse.json({ error: `Unknown system "${system}"` }, { status: 404 })
  }
  const seed = Number(body.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 99_999_999) {
    return NextResponse.json({ error: 'seed must be an integer in 0..99999999' }, { status: 400 })
  }

  try {
    const result = await promoteSeed(system, seed)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'promotion failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
