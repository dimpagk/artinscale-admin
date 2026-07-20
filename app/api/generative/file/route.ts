import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import { resolveSystemFile } from '@/lib/generative/server'

// Serves PNGs from inside a registered system's folder (render cache, print
// masters). Paths are sandboxed to the system directory by resolveSystemFile.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const system = request.nextUrl.searchParams.get('system') ?? ''
  const rel = request.nextUrl.searchParams.get('f') ?? ''
  const abs = resolveSystemFile(system, rel)
  if (!abs) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const buf = await fs.promises.readFile(abs)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'image/png',
      // Cache entries are content-addressed (seed + param hash in the name),
      // so a long client cache is safe.
      'Cache-Control': 'private, max-age=604800, immutable',
    },
  })
}
