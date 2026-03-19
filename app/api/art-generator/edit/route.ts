import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import {
  getGeneratedImageById,
  updateGeneratedImage,
} from '@/lib/generated-images'
import {
  MODEL_OPTIONS,
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

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: modelOption.modelId })

    // Multi-turn: first message with image + original prompt, second with edit instruction
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: imageBase64,
              },
            },
            { text: `Original prompt: ${existing.prompt}` },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              text: `Edit this image with the following instruction: ${body.instruction}`,
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'image/png' },
    })

    const response = result.response
    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (part: { inlineData?: { data: string; mimeType: string } }) => part.inlineData
    )

    if (!imagePart?.inlineData?.data) {
      return NextResponse.json(
        { error: 'No image returned from model' },
        { status: 500 }
      )
    }

    const newImageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')

    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const newStoragePath = `${year}/${month}/${crypto.randomUUID()}.png`

    await uploadFile('ai-generated', newStoragePath, newImageBuffer, {
      contentType: 'image/png',
    })

    const newPublicUrl = getPublicUrl('ai-generated', newStoragePath)

    const editEntry: EditHistoryEntry = {
      instruction: body.instruction,
      timestamp: now.toISOString(),
      model: modelOption.key,
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
