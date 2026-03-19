import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { createGeneratedImage } from '@/lib/generated-images'
import {
  buildFullPrompt,
  MODEL_OPTIONS,
  type GenerateParams,
} from '@/lib/constants/art-generator'

export async function POST(request: Request) {
  try {
    const body: GenerateParams = await request.json()

    if (!body.prompt || typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    const modelOption = MODEL_OPTIONS.find((m) => m.key === body.model) || MODEL_OPTIONS[0]

    const fullPrompt = buildFullPrompt(body)

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: modelOption.modelId })

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
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

    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')

    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const storagePath = `${year}/${month}/${crypto.randomUUID()}.png`

    await uploadFile('ai-generated', storagePath, imageBuffer, {
      contentType: 'image/png',
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
      },
    })

    if (!image) {
      return NextResponse.json(
        { error: 'Failed to save generated image record' },
        { status: 500 }
      )
    }

    return NextResponse.json({ image }, { status: 201 })
  } catch (error) {
    console.error('Art generator error:', error)
    return NextResponse.json(
      { error: 'Failed to generate image' },
      { status: 500 }
    )
  }
}
