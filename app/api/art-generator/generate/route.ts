import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { GoogleGenAI } from '@google/genai'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { createGeneratedImage } from '@/lib/generated-images'
import {
  buildFullPrompt,
  MODEL_OPTIONS,
  maxImageSizeForModel,
  toGeminiAspectRatio,
  type GenerateParams,
} from '@/lib/constants/art-generator'
import { parseImageDimensions, extensionForMime } from '@/lib/image-dimensions'
import { buildStyledPrompt } from '@/lib/style-packs'
import { getStylePackAsync } from '@/lib/style-packs/server'
import { loadExemplars } from '@/lib/style-packs/exemplars'
import { checkStyleSimilarity } from '@/lib/agents/style-similarity-check'
import {
  refineToStyle,
  REFINE_SCORE_THRESHOLD,
  REFINE_MEDIUM_THRESHOLD,
} from '@/lib/agents/style-refine'
import { tagVisualContent } from '@/lib/agents/visual-tagger'
import { updateGeneratedImage } from '@/lib/generated-images'
import { estimateGenerationCostUsd } from '@/lib/costs/pricing'

export async function POST(request: Request) {
  try {
    const body: GenerateParams = await request.json()

    if (!body.prompt || typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    const modelOption = MODEL_OPTIONS.find((m) => m.key === body.model) || MODEL_OPTIONS[0]

    // When a style pack is selected, it owns the entire style/palette/
    // composition envelope and supersedes the structured style/medium/mood
    // presets. Otherwise fall back to the legacy structured-prompt path.
    const fullPrompt = body.stylePackId
      ? buildStyledPrompt({
          stylePackId: body.stylePackId,
          subject: body.prompt,
          contributionContext: body.contributionContext,
        })
      : buildFullPrompt(body)

    const stylePackForRecord = body.stylePackId
      ? await getStylePackAsync(body.stylePackId)
      : null

    // Reference image conditioning. Prefers operator-approved exemplars
    // (images flipped via the gallery's "Mark as exemplar" action) over
    // the style pack's static referenceAssetPaths — so the artist's
    // voice tightens as the operator curates. Failures are non-fatal —
    // we fall back to text-only generation.
    const referenceParts: Array<{ inlineData: { mimeType: string; data: string } }> = []
    let referenceSourceCounts = { approved: 0, static_fallback: 0 }
    if (body.stylePackId) {
      const exemplars = await loadExemplars({
        stylePackId: body.stylePackId,
        staticFallbackPaths: stylePackForRecord?.referenceAssetPaths,
        baseUrlForStaticPaths: request.url.replace(/\/api\/.*$/, ''),
      })
      for (const ex of exemplars) {
        try {
          const refRes = await fetch(ex.imageUrl)
          if (!refRes.ok) {
            console.warn(`[generate] reference fetch ${ex.imageUrl} → ${refRes.status}`)
            continue
          }
          const buf = Buffer.from(await refRes.arrayBuffer())
          const mimeType = refRes.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
          referenceParts.push({
            inlineData: { mimeType, data: buf.toString('base64') },
          })
          referenceSourceCounts[ex.source] += 1
        } catch (err) {
          console.warn('[generate] reference image fetch failed (non-fatal):', err)
        }
      }
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! })

    const promptText = referenceParts.length
      ? `Reference images above show the artist's locked visual voice — match palette, line weight, composition discipline, and grain/texture patterns. Then create the new piece.\n\n${fullPrompt}`
      : fullPrompt

    // Generate at the model's max native resolution (4K on pro/flash,
    // 1K on lite) and the requested portrait aspect, so raster art is
    // print-grade instead of the old ~1K default. Note: image models
    // return PNGs via `inlineData` — do NOT set responseMimeType to
    // image/png (that field only accepts text/JSON/XML/YAML → 400).
    const response = await ai.models.generateContent({
      model: modelOption.modelId,
      contents: [
        {
          role: 'user',
          parts: [...referenceParts, { text: promptText }],
        },
      ],
      config: {
        imageConfig: {
          imageSize: maxImageSizeForModel(modelOption.key),
          aspectRatio: toGeminiAspectRatio(body.aspectRatio),
        },
      },
    })

    const candidate = response.candidates?.[0]
    const imagePart = candidate?.content?.parts?.find((part) => part.inlineData)

    if (!imagePart?.inlineData?.data) {
      // The API call succeeded but returned no image. Surface WHY — the
      // model usually explains itself in a text part (refusal, "too many
      // reference images", safety block), and finishReason / blockReason
      // carry the machine-readable cause. Without this the route reports a
      // bare "No image returned" and the real reason is lost.
      const textParts = candidate?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join(' ')
        .trim()
      const finishReason = candidate?.finishReason
      const blockReason = response.promptFeedback?.blockReason
      const reason =
        textParts || blockReason || finishReason || 'model returned no image and no explanation'
      console.error('[generate] no image returned from model:', {
        finishReason,
        blockReason,
        text: textParts,
        referenceImageCount: referenceParts.length,
      })
      return NextResponse.json(
        { error: `No image returned from model: ${reason}`, detail: reason },
        { status: 500 }
      )
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
    const outMime = imagePart.inlineData.mimeType || 'image/png'

    // Measure dimensions from the buffer header. Gemini 3.x returns
    // JPEG, so parse format-aware (PNG + JPEG) rather than assuming PNG.
    // Stamped on metadata for the gallery badge + print-safety later.
    let measuredDimensions: { width: number; height: number } | null = null
    try {
      const dims = parseImageDimensions(imageBuffer)
      if (dims) measuredDimensions = { width: dims.width, height: dims.height }
    } catch {
      // ignore — non-fatal
    }

    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const storagePath = `${year}/${month}/${crypto.randomUUID()}.${extensionForMime(outMime)}`

    await uploadFile('ai-generated', storagePath, imageBuffer, {
      contentType: outMime,
    })

    const publicUrl = getPublicUrl('ai-generated', storagePath)

    // Modelled cost of this generation (image call + the vision passes it
    // triggers). Rate card lives in lib/costs/pricing.ts; stamped on the
    // row so creation cost can roll up from the generated_images ledger.
    const estimatedCostUsd = estimateGenerationCostUsd({
      model: modelOption.key,
      usedStylePack: !!body.stylePackId,
    })

    const image = await createGeneratedImage({
      prompt: body.prompt,
      edit_history: [],
      model: modelOption.key,
      aspect_ratio: body.aspectRatio || '1:1',
      style_preset: body.style || null,
      image_url: publicUrl,
      storage_path: storagePath,
      topic_id: body.topicId || null,
      artwork_id: null,
      cost_usd: estimatedCostUsd,
      cost_source: 'estimated',
      metadata: {
        fullPrompt,
        medium: body.medium || null,
        mood: body.mood || null,
        contributionContext: body.contributionContext || null,
        stylePackId: body.stylePackId || null,
        stylePackPersonaUserId: stylePackForRecord?.persona.userId || null,
        referenceImageCount: referenceParts.length,
        referenceFromApprovedExemplars: referenceSourceCounts.approved,
        referenceFromStaticFallback: referenceSourceCounts.static_fallback,
        measuredDimensions,
        // Kept for back-compat with the gallery's running-total badge;
        // the authoritative figure now lives in the cost_usd column.
        estimatedCostUsd,
      },
    })

    if (!image) {
      return NextResponse.json(
        { error: 'Failed to save generated image record' },
        { status: 500 }
      )
    }

    // Post-generation vision passes + optional auto-refine.
    //   1. Score the original against the pack (overall voice + medium
    //      fidelity) and tag it. Advisory scoring only runs with a style pack.
    //   2. If auto-refine is on and the piece falls short on voice OR medium,
    //      apply ONE image-edit correction pass, re-score it, and return
    //      whichever scores higher. Both rows are kept and cross-linked; a bad
    //      correction can never replace a good original.
    // Everything here is best-effort — failures never block the response.
    let responseImage = image
    try {
      const [sim0, tags0] = await Promise.allSettled([
        body.stylePackId
          ? checkStyleSimilarity({ candidateImageUrl: publicUrl, stylePackId: body.stylePackId })
          : Promise.resolve(null),
        tagVisualContent({ imageUrl: publicUrl }),
      ])

      const originalMeta: Record<string, unknown> = { ...(image.metadata ?? {}) }
      const similarity0 = sim0.status === 'fulfilled' ? sim0.value : null
      if (sim0.status === 'rejected') {
        console.warn('[generate] style similarity failed (non-fatal):', sim0.reason)
      }
      if (similarity0) originalMeta.styleSimilarity = similarity0
      if (tags0.status === 'fulfilled') originalMeta.tags = tags0.value
      else console.warn('[generate] visual tagger failed (non-fatal):', tags0.reason)
      await updateGeneratedImage(image.id, { metadata: originalMeta })

      const autoRefineOn = !!body.stylePackId && body.autoRefine !== false
      const shortOnVoice =
        !!similarity0 &&
        (similarity0.score < REFINE_SCORE_THRESHOLD ||
          similarity0.mediumScore < REFINE_MEDIUM_THRESHOLD)

      if (autoRefineOn && shortOnVoice && similarity0?.fixInstructions) {
        const refined = await refineToStyle({
          source: image,
          stylePackId: body.stylePackId!,
          fixInstructions: similarity0.fixInstructions,
          modelKey: modelOption.key,
        })

        if (refined) {
          const [sim1, tags1] = await Promise.allSettled([
            checkStyleSimilarity({ candidateImageUrl: refined.image_url, stylePackId: body.stylePackId! }),
            tagVisualContent({ imageUrl: refined.image_url }),
          ])
          const similarity1 = sim1.status === 'fulfilled' ? sim1.value : null
          const originalScore = similarity0.score
          const refinedScore = similarity1?.score ?? -1
          const winner: 'refined' | 'original' = refinedScore > originalScore ? 'refined' : 'original'

          const refinedMeta: Record<string, unknown> = { ...(refined.metadata ?? {}) }
          if (similarity1) refinedMeta.styleSimilarity = similarity1
          if (tags1.status === 'fulfilled') refinedMeta.tags = tags1.value
          refinedMeta.autoRefine = {
            role: 'refined',
            winner,
            originalId: image.id,
            originalScore,
            refinedScore,
            fixInstructions: similarity0.fixInstructions,
          }
          const savedRefined = await updateGeneratedImage(refined.id, { metadata: refinedMeta })

          await updateGeneratedImage(image.id, {
            metadata: {
              ...originalMeta,
              autoRefine: { role: 'original', winner, refinedId: refined.id, originalScore, refinedScore },
            },
          })

          if (winner === 'refined') {
            responseImage = savedRefined ?? { ...refined, metadata: refinedMeta }
          }
        }
      }
    } catch (err) {
      console.warn('[generate] post-generation / auto-refine failed (non-fatal):', err)
    }

    return NextResponse.json({ image: responseImage }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[art-generator] generate failed:', error)
    return NextResponse.json(
      {
        error: `Failed to generate image: ${message}`,
        // Expose the message in dev so the client can show it.
        // Production deployments may want to scrub this — wrap in NODE_ENV check if so.
        detail: message,
      },
      { status: 500 }
    )
  }
}
