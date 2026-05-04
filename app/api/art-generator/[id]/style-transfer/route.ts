import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import {
  getGeneratedImageById,
  createGeneratedImage,
} from '@/lib/generated-images'
import { buildStyledPrompt } from '@/lib/style-packs'
import { getStylePackAsync } from '@/lib/style-packs/server'
import { tagVisualContent } from '@/lib/agents/visual-tagger'
import { checkStyleSimilarity } from '@/lib/agents/style-similarity-check'
import { updateGeneratedImage } from '@/lib/generated-images'

/**
 * Style transfer — re-render an existing image in a different artist's
 * voice. The result is a NEW `generated_images` row, not an edit of
 * the original.
 *
 * POST /api/art-generator/{id}/style-transfer
 *   body: { target_style_pack_id: string, model?: 'flash' | 'pro' }
 *
 * Pipeline:
 *   1. Fetch the source image (URL is public, no auth needed)
 *   2. Build the target style pack's full prompt envelope
 *   3. Send {source image inline, target prompt} to Gemini
 *      "Render this scene in the target artist's voice"
 *   4. Upload the new PNG, insert a new generated_images row
 *   5. Run the post-generation tagger + similarity check (fire-and-forget)
 *
 * Result: same composition, different palette + linework + artist voice.
 * Doubles the catalog multiplier on top of palette variants.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { target_style_pack_id?: string; model?: 'flash' | 'pro' }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.target_style_pack_id) {
    return NextResponse.json(
      { error: 'target_style_pack_id is required' },
      { status: 400 }
    )
  }

  const source = await getGeneratedImageById(id)
  if (!source) {
    return NextResponse.json({ error: 'Source image not found' }, { status: 404 })
  }

  const targetPack = await getStylePackAsync(body.target_style_pack_id)
  if (!targetPack) {
    return NextResponse.json(
      { error: `Target style pack ${body.target_style_pack_id} not found` },
      { status: 404 }
    )
  }

  // Build a transfer prompt: ask Gemini to use the source image as
  // composition reference but apply the target pack's voice.
  const targetVoice = buildStyledPrompt({
    stylePackId: targetPack.id,
    pack: targetPack,
    subject: source.prompt,
  })

  const transferPrompt = [
    `STYLE TRANSFER REQUEST.`,
    `Use the input image as composition + subject reference.`,
    `Re-render the scene completely in the artist voice described below.`,
    `The output should be visibly the same composition but unmistakably the new artist's hand.`,
    ``,
    targetVoice,
  ].join('\n')

  // Pull the source image bytes
  const srcRes = await fetch(source.image_url)
  if (!srcRes.ok) {
    return NextResponse.json(
      { error: `Could not fetch source image: ${srcRes.status}` },
      { status: 502 }
    )
  }
  const srcBuf = Buffer.from(await srcRes.arrayBuffer())
  const srcBase64 = srcBuf.toString('base64')

  // Call Gemini with the source image + the target voice as prompt
  const modelKey = body.model ?? 'flash'
  const modelId = 'gemini-2.5-flash-image' // matches the constants file
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: modelId })

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: srcBase64 } },
          { text: transferPrompt },
        ],
      },
    ],
  })

  const parts = result.response.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p: { inlineData?: { data: string } }) => p.inlineData)
  if (!imagePart?.inlineData?.data) {
    return NextResponse.json(
      { error: 'Gemini returned no image' },
      { status: 502 }
    )
  }
  const outBuffer = Buffer.from(imagePart.inlineData.data, 'base64')

  // Measure dimensions cheaply (PNG header)
  let measuredDimensions: { width: number; height: number } | null = null
  try {
    measuredDimensions = {
      width: outBuffer.readUInt32BE(16),
      height: outBuffer.readUInt32BE(20),
    }
  } catch {
    /* ignore */
  }

  const now = new Date()
  const yr = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const storagePath = `${yr}/${mo}/${crypto.randomUUID()}.png`

  await uploadFile('ai-generated', storagePath, outBuffer, {
    contentType: 'image/png',
  })
  const publicUrl = getPublicUrl('ai-generated', storagePath)

  const inserted = await createGeneratedImage({
    prompt: source.prompt,
    edit_history: [],
    model: modelKey,
    aspect_ratio: source.aspect_ratio,
    style_preset: null,
    image_url: publicUrl,
    storage_path: storagePath,
    topic_id: source.topic_id,
    artwork_id: null,
    metadata: {
      fullPrompt: transferPrompt,
      stylePackId: targetPack.id,
      stylePackPersonaUserId: targetPack.persona.userId,
      referenceImageCount: 1,
      measuredDimensions,
      estimatedCostUsd: 0.05, // image gen + tagging + similarity
      source: 'style_transfer',
      sourceImageId: source.id,
      sourceStylePackId: (source.metadata as Record<string, unknown> | null)?.stylePackId ?? null,
    },
  })
  if (!inserted) {
    return NextResponse.json(
      { error: 'Failed to record style-transferred image' },
      { status: 500 }
    )
  }

  // Post-generation vision passes — fire-and-forget
  void (async () => {
    try {
      const [similarity, tags] = await Promise.allSettled([
        checkStyleSimilarity({ candidateImageUrl: publicUrl, stylePackId: targetPack.id }),
        tagVisualContent({ imageUrl: publicUrl }),
      ])
      const newMeta: Record<string, unknown> = { ...(inserted.metadata ?? {}) }
      if (similarity.status === 'fulfilled') newMeta.styleSimilarity = similarity.value
      if (tags.status === 'fulfilled') newMeta.tags = tags.value
      await updateGeneratedImage(inserted.id, { metadata: newMeta })
    } catch {
      /* non-fatal */
    }
  })()

  return NextResponse.json({ image: inserted, sourceImageId: source.id })
}
