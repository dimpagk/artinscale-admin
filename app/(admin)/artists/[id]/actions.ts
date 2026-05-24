'use server'

import { revalidatePath } from 'next/cache'
import { setPrimaryStylePack } from '@/lib/style-packs/server'
import { fetchStylePackFromDb } from '@/lib/style-packs/db'

interface SetPrimaryInput {
  artistId: string
  packId: string
}

/**
 * Promote a style pack to "primary" for an artist. The previous primary
 * is automatically demoted (atomic via the partial unique index +
 * setPrimaryStylePack helper in lib/style-packs/db).
 */
export async function setPrimaryStylePackAction(input: SetPrimaryInput): Promise<void> {
  const pack = await fetchStylePackFromDb(input.packId)
  if (!pack) {
    throw new Error(`Style pack "${input.packId}" not found in DB`)
  }
  if (pack.persona.userId !== input.artistId) {
    throw new Error(
      `Pack "${input.packId}" doesn't belong to artist ${input.artistId}`
    )
  }

  await setPrimaryStylePack(input.artistId, input.packId)

  revalidatePath(`/artists/${input.artistId}`)
  revalidatePath('/artists')
  revalidatePath(`/styles/${input.packId}`)
  revalidatePath('/styles')
}
