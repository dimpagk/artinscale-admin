// Turning a chosen seed into an artpiece: render the canonical print master,
// upload it, create the artworks row with generative provenance, and hand the
// rest of the process (Gelato push, listing, mockups) to the existing artwork
// detail page. Requires sql/049_generative_provenance.sql and
// sql/050_generative_version.sql to be applied.

import fs from 'node:fs'
import path from 'node:path'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { getProductDefaults } from '@/lib/pricing-defaults'
import { findSystem } from './registry'
import { renderCached, systemDir, systemVersion } from './server'

// Pinned studio persona UUIDs (sql/047, sql/048).
const ARTIST_UUIDS: Record<string, string> = {
  a10: '00000000-0000-0000-0000-000000000a10',
  a11: '00000000-0000-0000-0000-000000000a11',
}

// Every deterministic system exports one print size: 40x50cm at 300 DPI
// (print sizing policy: one size per piece, the largest the master carries).
const PRODUCT_TYPE = 'museum-poster-40x50'

export interface PromotedSeed {
  seed: number
  artworkId: string
  status: string
}

const MIGRATION_HINT =
  'generative provenance columns missing: apply sql/049_generative_provenance.sql and sql/050_generative_version.sql in the Supabase SQL editor, then retry.'

// Supabase client errors are plain objects (PostgrestError), not Error
// instances; pull the message out of either shape.
function errMessage(err: unknown): string {
  // Walk the wrapper chain (undici puts the real reason in `cause`,
  // supabase storage in `originalError`); surface every distinct message or
  // the operator only sees a useless "fetch failed".
  const parts: string[] = []
  let cur: unknown = err
  for (let depth = 0; cur && depth < 5; depth++) {
    const obj = cur as { message?: unknown; cause?: unknown; originalError?: unknown; code?: unknown }
    const msg =
      typeof obj === 'object' && obj !== null && obj.message !== undefined
        ? String(obj.message)
        : String(cur)
    const code = typeof obj === 'object' && obj !== null && obj.code ? ` [${String(obj.code)}]` : ''
    if (!parts.includes(msg + code)) parts.push(msg + code)
    cur = typeof obj === 'object' && obj !== null ? (obj.cause ?? obj.originalError) : undefined
  }
  return parts.join(': ')
}

function isMissingColumnError(err: unknown): boolean {
  const msg = errMessage(err)
  return (
    /generative_system|generative_seed|generative_version/.test(msg) &&
    /column|schema/i.test(msg)
  )
}

/** Seeds of one system that are already artworks. */
export async function promotedSeeds(
  systemId: string
): Promise<{ seeds: PromotedSeed[]; migrationNeeded: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('artworks')
    .select('id, generative_seed, status')
    .eq('generative_system', systemId)
    .not('generative_seed', 'is', null)
  if (error) {
    if (isMissingColumnError(error)) return { seeds: [], migrationNeeded: true }
    throw new Error(errMessage(error))
  }
  return {
    migrationNeeded: false,
    seeds: (data ?? []).map((r) => ({
      seed: r.generative_seed as number,
      artworkId: r.id as string,
      status: (r.status as string) ?? 'created',
    })),
  }
}

/** Count of promoted seeds per system, for the index cards. */
export async function promotedCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin
    .from('artworks')
    .select('generative_system')
    .not('generative_system', 'is', null)
  if (error) return {}
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const sys = row.generative_system as string
    counts[sys] = (counts[sys] ?? 0) + 1
  }
  return counts
}

export async function promoteSeed(
  systemId: string,
  seed: number
): Promise<{ artworkId: string; existing: boolean }> {
  const found = findSystem(systemId)
  if (!found) throw new Error(`Unknown system "${systemId}"`)
  const { artist, system } = found
  const artistId = ARTIST_UUIDS[artist.code]
  if (!artistId) throw new Error(`No persona UUID for artist code "${artist.code}"`)
  const dir = systemDir(systemId)
  if (!dir) throw new Error('Renderer offline; promotion needs the workspace repo.')

  // Refuse silently double-promoting: the seed IS the piece.
  const { seeds, migrationNeeded } = await promotedSeeds(systemId)
  if (migrationNeeded) throw new Error(MIGRATION_HINT)
  const already = seeds.find((s) => s.seed === seed)
  if (already) return { artworkId: already.artworkId, existing: true }

  // 1. The canonical print master (no param overrides: seeds are chosen,
  // never retouched). Cached if the operator already rendered it.
  const { relPath } = await renderCached({ system: systemId, kind: 'master', seed, params: {} })
  const buffer = await fs.promises.readFile(path.join(dir, relPath))

  // 2. Upload the master; stable path so re-promotion attempts overwrite
  // rather than accumulate. The first large POST after idle regularly dies
  // with a bare "fetch failed" (undici reusing a keep-alive socket the
  // server already closed), so retry once: the upsert upload is idempotent.
  const seedTag = `s${String(seed).padStart(6, '0')}`
  const storagePath = `generative/${systemId}/${systemId}-${seedTag}-print-40x50-300dpi.png`
  try {
    await uploadFile('ai-generated', storagePath, buffer, {
      contentType: 'image/png',
      upsert: true,
    })
  } catch {
    await uploadFile('ai-generated', storagePath, buffer, {
      contentType: 'image/png',
      upsert: true,
    })
  }
  const imageUrl = getPublicUrl('ai-generated', storagePath)

  // 3. The artworks row (admin-managed source of truth). Insert directly so
  // provenance is atomic with creation: if 049 is missing this fails before
  // any row exists. Price/edition prefill from the 40x50 defaults; the
  // operator finishes copy, pricing and listing on /artworks/[id].
  const defaults = getProductDefaults(PRODUCT_TYPE)
  const title = `${system.title} S-${String(seed).padStart(6, '0')}`
  const { data: created, error } = await supabaseAdmin
    .from('artworks')
    .insert({
      title,
      description: null,
      image_url: imageUrl,
      artist_id: artistId,
      status: 'created',
      edition_size: defaults?.editionSize ?? null,
      edition_sold: 0,
      price: defaults?.price ?? null,
      currency: defaults?.currency ?? 'EUR',
      product_type: PRODUCT_TYPE,
      creation_date: new Date().toISOString().slice(0, 10),
      inspiration_summary: `Deterministic drawing system "${system.title}" (generative/${systemId}), seed ${seed}, algorithm ${systemVersion(systemId) ?? 'unknown'}. Rendered from code at 300 DPI; the same seed on the same algorithm always yields the same piece.`,
      creation_source: 'manual',
      generative_system: systemId,
      generative_seed: seed,
      generative_version: systemVersion(systemId),
    })
    .select('id')
    .single()
  if (error) {
    if (isMissingColumnError(error)) throw new Error(MIGRATION_HINT)
    throw new Error(errMessage(error))
  }
  return { artworkId: (created as { id: string }).id, existing: false }
}
