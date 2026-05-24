'use server'

import { revalidatePath } from 'next/cache'
import { upsertStylePack, fetchStylePackFromDb } from '@/lib/style-packs/db'
import { getStylePack as getJsonStylePack, type StylePack } from '@/lib/style-packs'

interface UpdateStylePackInput {
  id: string
  enabledForLaunch: boolean
  vectorizesWell: boolean
  personaName: string
  personaTagline: string
  personaBio: string
  personaProcess: string
  promptMaster: string
  promptNegative: string
  paletteColors: string  // comma-separated hex
  paletteDescription: string
  compositionPlacement: string
  compositionMaxSubjects: number
  compositionAspectRatios: string  // comma-separated
  compositionNotes: string
}

export async function updateStylePackAction(input: UpdateStylePackInput): Promise<{ ok: true }> {
  // Start from existing pack (DB or JSON) to preserve fields we don't expose
  // in the form (referenceAssetPaths, persona email/userId, etc.)
  const existing =
    (await fetchStylePackFromDb(input.id)) ??
    getJsonStylePack(input.id)

  if (!existing) {
    throw new Error(`Style pack ${input.id} not found`)
  }

  const colors = input.paletteColors
    .split(/[,\n]/)
    .map((c) => c.trim())
    .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c))

  if (colors.length === 0) {
    throw new Error('Palette must contain at least one valid #RRGGBB hex color')
  }

  const aspectRatios = input.compositionAspectRatios
    .split(/[,\s]+/)
    .map((r) => r.trim())
    .filter(Boolean)

  if (aspectRatios.length === 0) {
    throw new Error('Composition must include at least one aspect ratio')
  }

  const updated: StylePack = {
    ...existing,
    id: input.id,
    enabledForLaunch: input.enabledForLaunch,
    vectorizesWell: input.vectorizesWell,
    persona: {
      ...existing.persona,
      name: input.personaName.trim(),
      tagline: input.personaTagline.trim(),
      bioMd: input.personaBio.trim(),
      processMd: input.personaProcess.trim(),
    },
    prompt: {
      master: input.promptMaster.trim(),
      negative: input.promptNegative.trim(),
    },
    palette: {
      colors,
      description: input.paletteDescription.trim(),
    },
    composition: {
      ...existing.composition,
      aspectRatios,
      subjectPlacement: input.compositionPlacement.trim(),
      maxSubjects: Math.max(1, Math.min(10, Math.floor(input.compositionMaxSubjects))),
      notes: input.compositionNotes.trim(),
    },
  }

  await upsertStylePack(updated)
  revalidatePath('/styles')
  revalidatePath(`/styles/${input.id}`)
  return { ok: true }
}
