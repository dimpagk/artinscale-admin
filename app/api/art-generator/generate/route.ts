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
import { tagVisualContent } from '@/lib/agents/visual-tagger'
import { updateGeneratedImage } from '@/lib/generated-images'

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

    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData
    )

    if (!imagePart?.inlineData?.data) {
      return NextResponse.json(
        { error: 'No image returned from model' },
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
        // Cost ledger: ~$0.04 Gemini image generation (varies, but a
        // safe round number) + ~$0.02 Claude vision similarity check
        // when a style pack is in use. Not exact — surfaced as a rough
        // running total in the gallery so the operator has a feel.
        estimatedCostUsd: 0.04 + (body.stylePackId ? 0.02 : 0),
      },
    })

    if (!image) {
      return NextResponse.json(
        { error: 'Failed to save generated image record' },
        { status: 500 }
      )
    }

    // Run two post-generation Claude vision passes in parallel:
    //   1. Style similarity (advisory — only when a style pack is in use)
    //   2. Visual tagger (always, drives gallery filters + future tuning)
    // Both are best-effort. Failures are logged, never blocks the response.
    try {
      const [similarity, tags] = await Promise.allSettled([
        body.stylePackId
          ? checkStyleSimilarity({
              candidateImageUrl: publicUrl,
              stylePackId: body.stylePackId,
            })
          : Promise.resolve(null),
        tagVisualContent({ imageUrl: publicUrl }),
      ])

      const newMetadata: Record<string, unknown> = { ...(image.metadata ?? {}) }
      if (similarity.status === 'fulfilled' && similarity.value) {
        newMetadata.styleSimilarity = similarity.value
      } else if (similarity.status === 'rejected') {
        console.warn('[generate] style similarity failed (non-fatal):', similarity.reason)
      }
      if (tags.status === 'fulfilled') {
        newMetadata.tags = tags.value
      } else {
        console.warn('[generate] visual tagger failed (non-fatal):', tags.reason)
      }
      await updateGeneratedImage(image.id, { metadata: newMetadata })
    } catch (err) {
      console.warn('[generate] post-generation vision pass failed (non-fatal):', err)
    }

    return NextResponse.json({ image }, { status: 201 })
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
