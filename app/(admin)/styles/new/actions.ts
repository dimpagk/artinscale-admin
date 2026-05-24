'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { upsertStylePack, fetchStylePackFromDb } from '@/lib/style-packs/db'
import {
  getStylePack as getJsonStylePack,
  listStylePacks,
  type StylePack,
} from '@/lib/style-packs'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface CreateStylePackInput {
  /** New pack id, kebab-case (e.g. "midcentury-poster") */
  id: string
  /** Artist UUID this pack belongs to (becomes persona.userId) */
  artistId: string
  /** Optional pack id to seed from. If omitted, a sparse template is used. */
  copyFromId?: string | null
}

/**
 * Create a new style pack and link it to the given artist.
 *
 * Strategy:
 *   1. Validate the new id (kebab-case, not already taken)
 *   2. Validate the artist exists + has role=ARTIST
 *   3. Refuse if the artist already owns another pack (1:1 model)
 *   4. Seed body from `copyFromId` (template) or sensible defaults
 *   5. Set persona.userId/email/name from the artist
 *   6. upsert + redirect to /styles/{newId} for further editing
 */
export async function createStylePackAction(input: CreateStylePackInput): Promise<void> {
  const id = input.id.trim().toLowerCase()
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) {
    throw new Error(
      'Invalid id — must be kebab-case, start with a letter, 2-64 chars (e.g. "midcentury-poster")'
    )
  }

  // Already taken in DB or JSON?
  const existing = (await fetchStylePackFromDb(id)) ?? getJsonStylePack(id)
  if (existing) {
    throw new Error(`Style pack "${id}" already exists`)
  }

  // Validate artist
  const { data: artistRow } = await supabaseAdmin
    .from('users')
    .select('id, email, name, role')
    .eq('id', input.artistId)
    .maybeSingle()

  type ArtistRow = { id: string; email: string; name: string | null; role: string }
  const artist = artistRow as ArtistRow | null

  if (!artist || artist.role !== 'ARTIST') {
    throw new Error('Artist not found or not in role=ARTIST')
  }

  // Multi-pack model (migration 014): an artist can own multiple packs.
  // The new pack is primary only if the artist doesn't already have one.
  const allPacks = listStylePacks()
  const { data: dbPacks } = await supabaseAdmin
    .from('style_packs')
    .select('id, pack, is_primary')
  type DbPackRow = { id: string; pack: StylePack; is_primary?: boolean }
  const allFromDb = (dbPacks ?? []) as DbPackRow[]

  const ownedJson = allPacks.filter((p) => p.persona.userId === input.artistId)
  const ownedDb = allFromDb.filter((row) => row.pack?.persona?.userId === input.artistId)
  const artistHasAnyPack = ownedJson.length > 0 || ownedDb.length > 0
  // The new pack should only be primary if the artist has zero packs today.
  const shouldBePrimary = !artistHasAnyPack

  // Build the new pack — seed from copyFromId if given
  const template =
    input.copyFromId
      ? (await fetchStylePackFromDb(input.copyFromId)) ?? getJsonStylePack(input.copyFromId)
      : null

  const seeded: StylePack = template
    ? {
        ...template,
        id,
        enabledForLaunch: false,
        isPrimary: shouldBePrimary,
        persona: {
          ...template.persona,
          name: artist.name ?? template.persona.name,
          tagline: 'TBD — describe this artist\'s voice',
          bioMd: '',
          processMd: '',
          email: artist.email,
          userId: input.artistId,
        },
      }
    : {
        id,
        enabledForLaunch: false,
        vectorizesWell: true,
        isPrimary: shouldBePrimary,
        persona: {
          name: artist.name ?? 'Untitled artist',
          tagline: 'TBD — describe this artist\'s voice',
          bioMd: '',
          processMd: '',
          email: artist.email,
          userId: input.artistId,
        },
        prompt: {
          master: 'TBD — write the master style description here.',
          negative: '',
        },
        palette: {
          colors: ['#000000', '#ffffff'],
          description: 'TBD — describe how the palette is used.',
        },
        composition: {
          aspectRatios: ['1:1'],
          subjectPlacement: 'center-weighted',
          maxSubjects: 1,
          notes: '',
        },
        referenceAssetPaths: [],
      }

  await upsertStylePack(seeded)

  revalidatePath('/styles')
  revalidatePath('/artists')
  revalidatePath(`/artists/${input.artistId}`)
  redirect(`/styles/${id}`)
}
