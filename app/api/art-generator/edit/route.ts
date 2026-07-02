import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { GoogleGenAI } from '@google/genai'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { extensionForMime } from '@/lib/image-dimensions'
import {
  getGeneratedImageById,
  updateGeneratedImage,
  createGeneratedImage,
  stripDerivedMetadata,
} from '@/lib/generated-images'
import {
  MODEL_OPTIONS,
  maxImageSizeForModel,
  type EditParams,
  type EditHistoryEntry,
} from '@/lib/constants/art-generator'

export async function POST(request: Request) {
  try {
    const body: EditParams = await request.json()

    if (!body.imageId || !body.instruction) {
      return NextResponse.json(
        { error: 'imageId and instruction are required' },
        { status: 400 }
      )
    }

    const existing = await getGeneratedImageById(body.imageId)
    if (!existing) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    // Fetch the current image and convert to base64
    const imageResponse = await fetch(existing.image_url)
    const imageArrayBuffer = await imageResponse.arrayBuffer()
    const imageBase64 = Buffer.from(imageArrayBuffer).toString('base64')

    const modelOption =
      MODEL_OPTIONS.find((m) => m.key === body.model) || MODEL_OPTIONS[0]

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! })

    // When a mask is supplied (Tier 4 #12 — inpainting), prepend it as
    // a second image and tell Gemini to honor it. Without a mask the
    // edit is global, same as before.
    const hasMask = typeof body.maskBase64 === 'string' && body.maskBase64.length > 0
    const editInstruction = hasMask
      ? [
          'INPAINTING REQUEST.',
          'You are given two images: (1) the source artwork, (2) a binary mask.',
          'In the mask, WHITE pixels mark the regions you should edit. BLACK pixels must be left untouched.',
          'Preserve the source image exactly outside the white regions — same composition, same colors, same line work.',
          'Inside the white regions, apply this change:',
          body.instruction,
        ].join('\n')
      : `Edit this image with the following instruction: ${body.instruction}`

    const firstTurnParts: Array<
      | { inlineData: { mimeType: string; data: string } }
      | { text: string }
    > = [
      { inlineData: { mimeType: 'image/png', data: imageBase64 } },
    ]
    if (hasMask) {
      firstTurnParts.push({
        inlineData: { mimeType: 'image/png', data: body.maskBase64! },
      })
    }
    firstTurnParts.push({ text: `Original prompt: ${existing.prompt}` })

    const response = await ai.models.generateContent({
      model: modelOption.modelId,
      contents: [
        { role: 'user', parts: firstTurnParts },
        { role: 'user', parts: [{ text: editInstruction }] },
      ],
      // Keep edits at the model's max resolution so iterating doesn't
      // downgrade print quality. No aspectRatio — preserve the source
      // image's shape. See note in generate/route.ts — image models
      // return PNGs via inlineData; responseMimeType 'image/png' 400s.
      config: {
        imageConfig: { imageSize: maxImageSizeForModel(modelOption.key) },
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

    const newImageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
    const outMime = imagePart.inlineData.mimeType || 'image/png'

    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const newStoragePath = `${year}/${month}/${crypto.randomUUID()}.${extensionForMime(outMime)}`

    await uploadFile('ai-generated', newStoragePath, newImageBuffer, {
      contentType: outMime,
    })

    const newPublicUrl = getPublicUrl('ai-generated', newStoragePath)

    // Each edit history entry captures the PREVIOUS image URL so the
    // operator can compare versions in the editor and restore back to
    // an earlier state if the latest edit went the wrong direction.
    const editEntry: EditHistoryEntry = {
      instruction: hasMask ? `[masked] ${body.instruction}` : body.instruction,
      timestamp: now.toISOString(),
      model: modelOption.key,
      previousImageUrl: existing.image_url,
      previousStoragePath: existing.storage_path,
    }

    // saveAsNew → branch into a fresh generated_images row so the
    // operator keeps the original alongside the edited version. The
    // new row's edit_history starts with this single edit entry, so
    // they can still see what change produced it.
    if (body.saveAsNew) {
      const branched = await createGeneratedImage({
        prompt: existing.prompt,
        edit_history: [editEntry],
        model: existing.model,
        aspect_ratio: existing.aspect_ratio,
        style_preset: existing.style_preset,
        image_url: newPublicUrl,
        storage_path: newStoragePath,
        topic_id: existing.topic_id,
        artwork_id: null,
        metadata: {
          // Carry style/topic context but drop per-image state that
          // shouldn't follow a branch (exemplar, vector, upscale).
          ...stripDerivedMetadata(
            (existing.metadata as Record<string, unknown> | null) || {}
          ),
          forkedFromImageId: existing.id,
          forkPoint: 'edit-branch',
          forkLabel: hasMask ? `[masked] ${body.instruction}` : body.instruction,
          exemplar: false,
          exemplarMarkedAt: null,
          vector: undefined,
        },
      })

      if (!branched) {
        return NextResponse.json(
          { error: 'Failed to create branched image record' },
          { status: 500 }
        )
      }

      return NextResponse.json({ image: branched, branched: true })
    }

    const image = await updateGeneratedImage(body.imageId, {
      image_url: newPublicUrl,
      storage_path: newStoragePath,
      edit_history: [...(existing.edit_history || []), editEntry],
    })

    if (!image) {
      return NextResponse.json(
        { error: 'Failed to update image record' },
        { status: 500 }
      )
    }

    return NextResponse.json({ image })
  } catch (error) {
    console.error('Art generator edit error:', error)
    return NextResponse.json(
      { error: 'Failed to edit image' },
      { status: 500 }
    )
  }
}

