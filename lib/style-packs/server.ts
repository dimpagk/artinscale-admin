import 'server-only'

import type { StylePack } from './types'
import { fetchStylePacksFromDb, fetchStylePackFromDb } from './db'
import { getStylePack, listStylePacks } from './index'

/**
 * Server-only DB-aware style pack lookups.
 *
 * Imports `supabaseAdmin` transitively (via ./db). Server components,
 * route handlers, and agents must import from this module — never from
 * `@/lib/style-packs/index`, which is JSON-only and client-safe.
 *
 * The 'server-only' import at the top of this file makes Next.js refuse
 * to bundle it into a client component, throwing a clear error at build
 * time if a client component accidentally imports from here.
 */

/**
 * DB-aware lookup. Prefers the `style_packs` row when one exists,
 * otherwise falls back to the JSON registry. Use in server routes +
 * agents so operator edits via /styles are honored at runtime.
 */
export async function getStylePackAsync(id: string): Promise<StylePack | null> {
  const fromDb = await fetchStylePackFromDb(id)
  if (fromDb) return fromDb
  return getStylePack(id)
}

export async function listStylePacksAsync(): Promise<StylePack[]> {
  const fromDb = await fetchStylePacksFromDb()
  const dbIds = new Set(fromDb.map((p) => p.id))
  const jsonOnly = listStylePacks().filter((p) => !dbIds.has(p.id))
  return [...fromDb, ...jsonOnly]
}

export async function listLaunchStylePacksAsync(): Promise<StylePack[]> {
  const all = await listStylePacksAsync()
  return all.filter((p) => p.enabledForLaunch)
}

/**
 * DB-aware artist → primary style pack lookup. Use in agents and server
 * routes so operator edits via /styles are honored.
 *
 * Multi-pack behavior (migration 014): an artist can own multiple packs
 * but exactly one is marked `isPrimary`. This helper returns the primary
 * pack; if no pack is explicitly primary (e.g. legacy data), it falls
 * back to the first pack found for that artist.
 */
export async function getStylePackForArtistAsync(
  artistId: string | null | undefined
): Promise<StylePack | null> {
  if (!artistId) return null
  const owned = await listStylePacksByArtistAsync(artistId)
  return owned.find((p) => p.isPrimary !== false) ?? owned[0] ?? null
}

/**
 * All packs an artist owns, in primary-first order. Used by the artist
 * edit page (multi-pack list) and the AI Art Generator dropdown when it
 * wants to show variants per artist.
 */
export async function listStylePacksByArtistAsync(
  artistId: string | null | undefined
): Promise<StylePack[]> {
  if (!artistId) return []
  const all = await listStylePacksAsync()
  return all
    .filter((p) => p.persona.userId === artistId)
    .sort((a, b) => {
      const aPrim = a.isPrimary !== false ? 0 : 1
      const bPrim = b.isPrimary !== false ? 0 : 1
      return aPrim - bPrim
    })
}

export { setPrimaryStylePack } from './db'
