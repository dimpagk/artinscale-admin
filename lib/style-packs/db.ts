/**
 * DB-backed style pack lookups.
 *
 * Loader strategy: try the `style_packs` table first; fall back to the
 * static JSON file shipped with this repo. This means:
 *   - In environments where migration 013 hasn't run, JSON wins
 *   - In environments where it has, DB edits override JSON
 *   - Migration 014 added artist_id + is_primary columns; both are
 *     surfaced on the returned StylePack so callers can do
 *     primary-aware lookups without re-querying.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { StylePack } from './types'

interface StylePackRow {
  id: string
  enabled_for_launch: boolean
  vectorizes_well: boolean
  artist_id: string | null
  is_primary: boolean
  pack: StylePack
  updated_at: string
}

const SELECT_COLUMNS = 'id, enabled_for_launch, vectorizes_well, artist_id, is_primary, pack, updated_at'

function rowToPack(row: StylePackRow): StylePack {
  return {
    ...row.pack,
    id: row.id,
    enabledForLaunch: row.enabled_for_launch,
    vectorizesWell: row.vectorizes_well,
    isPrimary: row.is_primary,
    // Reconcile persona.userId with the denormalized artist_id column —
    // artist_id is the source of truth (FK-enforced, indexed).
    persona: row.artist_id
      ? { ...row.pack.persona, userId: row.artist_id }
      : row.pack.persona,
  }
}

export async function fetchStylePacksFromDb(): Promise<StylePack[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('style_packs')
      .select(SELECT_COLUMNS)
      .order('updated_at', { ascending: false })

    if (error) {
      // Table or columns missing — caller falls back to JSON.
      if (error.code === '42P01' || error.code === '42703') return []
      console.warn('[style-packs/db] fetch failed:', error.message)
      return []
    }

    return (data ?? []).map((row) => rowToPack(row as StylePackRow))
  } catch (err) {
    console.warn('[style-packs/db] fetch threw:', err)
    return []
  }
}

export async function fetchStylePackFromDb(id: string): Promise<StylePack | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('style_packs')
      .select(SELECT_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return null
    return rowToPack(data as StylePackRow)
  } catch {
    return null
  }
}

export async function upsertStylePack(pack: StylePack): Promise<void> {
  const { error } = await supabaseAdmin
    .from('style_packs')
    .upsert({
      id: pack.id,
      enabled_for_launch: pack.enabledForLaunch,
      vectorizes_well: pack.vectorizesWell,
      artist_id: pack.persona.userId || null,
      is_primary: pack.isPrimary ?? true,
      pack,
    })
  if (error) throw new Error(`upsertStylePack failed: ${error.message}`)
}

/**
 * Atomically demote the artist's current primary pack and promote a new
 * one. Two updates with no transaction guarantees — the partial unique
 * index would reject promoting before demotion, so we demote first.
 *
 * Caller is expected to have validated:
 *   - newPrimaryPackId belongs to artistId
 *   - newPrimaryPackId exists
 */
export async function setPrimaryStylePack(
  artistId: string,
  newPrimaryPackId: string
): Promise<void> {
  // Demote any current primary for this artist (except the target —
  // it's already primary or about to be promoted, no-op either way).
  const { error: demoteError } = await supabaseAdmin
    .from('style_packs')
    .update({ is_primary: false })
    .eq('artist_id', artistId)
    .eq('is_primary', true)
    .neq('id', newPrimaryPackId)
  if (demoteError) {
    throw new Error(`setPrimaryStylePack demote failed: ${demoteError.message}`)
  }

  // Promote the target.
  const { error: promoteError } = await supabaseAdmin
    .from('style_packs')
    .update({ is_primary: true })
    .eq('id', newPrimaryPackId)
  if (promoteError) {
    throw new Error(`setPrimaryStylePack promote failed: ${promoteError.message}`)
  }
}
