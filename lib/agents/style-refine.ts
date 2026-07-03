/**
 * Auto-refine pass.
 *
 * When the style critic (lib/agents/style-similarity-check.ts) judges a
 * fresh generation as off-voice or, especially, off-*medium*, it emits
 * `fixInstructions`. This module applies exactly one image-edit correction
 * pass: it feeds the generated image back to Gemini/Nano Banana with an
 * instruction to fix ONLY what the critic flagged while preserving the
 * subject, pose, and composition, and records the result as a NEW
 * generated_images row (source: 'style_refine', linked to the original).
 *
 * It never mutates or deletes the original. The generate route re-scores
 * the refined image and keeps whichever scores higher, so a bad correction
 * can never replace a good original.
 *
 * Thresholds: refine triggers when overall score OR medium score is below
 * these. Medium is held to a stricter bar because "follow the medium well"
 * is the point of the pass.
 */

import crypto from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { createGeneratedImage } from '@/lib/generated-images'
import type { GeneratedImage, ModelKey } from '@/lib/constants/art-generator'
import { MODEL_OPTIONS, maxImageSizeForModel } from '@/lib/constants/art-generator'
import { getStylePack } from '@/lib/style-packs'
import { parseImageDimensions, extensionForMime } from '@/lib/image-dimensions'
import { estimateGenerationCostUsd } from '@/lib/costs/pricing'

/** Refine when the overall voice score is below this. */
export const REFINE_SCORE_THRESHOLD = 0.75
/** Refine when the medium-fidelity score is below this (stricter). */
export const REFINE_MEDIUM_THRESHOLD = 0.8

/**
 * Apply one correction pass to `source` using the critic's fixInstructions.
 * Returns the new (unscored) generated_images row, or null on failure.
 * All failures are non-fatal: the caller falls back to the original.
 */
export async function refineToStyle(args: {
  source: GeneratedImage
  stylePackId: string
  fixInstructions: string
  modelKey: ModelKey
}): Promise<GeneratedImage | null> {
  const pack = getStylePack(args.stylePackId)
  if (!pack) {
    console.warn(`[style-refine] unknown style pack ${args.stylePackId}`)
    return null
  }

  const refinePrompt = [
    'IMAGE CORRECTION PASS.',
    'The input image already has the right subject and composition. Keep them exactly:',
    'do not move the subject, change the pose, reframe, or reinterpret the scene.',
    '',
    'Apply ONLY these corrections:',
    args.fixInstructions,
    '',
    `The medium is non-negotiable and must read true: ${pack.prompt.master}`,
    `Never drift into: ${pack.prompt.negative}`,
    `Palette stays locked to: ${pack.palette.colors.join(', ')}.`,
    '',
    'Output the corrected image at the same framing as the input.',
  ].join('\n')

  // Pull source bytes.
  let srcBase64: string
  try {
    const srcRes = await fetch(args.source.image_url)
    if (!srcRes.ok) {
      console.warn(`[style-refine] source fetch ${args.source.image_url} → ${srcRes.status}`)
      return null
    }
    srcBase64 = Buffer.from(await srcRes.arrayBuffer()).toString('base64')
  } catch (err) {
    console.warn('[style-refine] source fetch failed:', err)
    return null
  }

  const modelId =
    MODEL_OPTIONS.find((m) => m.key === args.modelKey)?.modelId ?? MODEL_OPTIONS[0].modelId
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! })

  let outBuffer: Buffer
  let outMime: string
  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: srcBase64 } },
            { text: refinePrompt },
          ],
        },
      ],
      // Preserve the source framing — no aspectRatio. Max size keeps it
      // print-grade like the original.
      config: { imageConfig: { imageSize: maxImageSizeForModel(args.modelKey) } },
    })
    const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
    if (!part?.inlineData?.data) {
      console.warn('[style-refine] Gemini returned no image')
      return null
    }
    outBuffer = Buffer.from(part.inlineData.data, 'base64')
    outMime = part.inlineData.mimeType || 'image/png'
  } catch (err) {
    console.warn('[style-refine] Gemini edit call failed:', err)
    return null
  }

  let measuredDimensions: { width: number; height: number } | null = null
  try {
    const dims = parseImageDimensions(outBuffer)
    if (dims) measuredDimensions = { width: dims.width, height: dims.height }
  } catch {
    /* ignore */
  }

  const now = new Date()
  const yr = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const storagePath = `${yr}/${mo}/${crypto.randomUUID()}.${extensionForMime(outMime)}`

  try {
    await uploadFile('ai-generated', storagePath, outBuffer, { contentType: outMime })
  } catch (err) {
    console.warn('[style-refine] upload failed:', err)
    return null
  }
  const publicUrl = getPublicUrl('ai-generated', storagePath)

  const sourceMeta = (args.source.metadata as Record<string, unknown> | null) ?? {}

  return createGeneratedImage({
    prompt: args.source.prompt,
    edit_history: [],
    model: args.modelKey,
    aspect_ratio: args.source.aspect_ratio,
    style_preset: null,
    image_url: publicUrl,
    storage_path: storagePath,
    topic_id: args.source.topic_id,
    artwork_id: null,
    cost_usd: estimateGenerationCostUsd({ model: args.modelKey, usedStylePack: true }),
    cost_source: 'estimated',
    metadata: {
      fullPrompt: refinePrompt,
      stylePackId: args.stylePackId,
      stylePackPersonaUserId: sourceMeta.stylePackPersonaUserId ?? pack.persona.userId,
      measuredDimensions,
      source: 'style_refine',
      sourceImageId: args.source.id,
      fixInstructionsApplied: args.fixInstructions,
      refineIteration: 1,
    },
  })
}
