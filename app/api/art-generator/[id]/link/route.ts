import { NextResponse } from 'next/server'
import { updateGeneratedImage } from '@/lib/generated-images'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    if (!body.artworkId || typeof body.artworkId !== 'string') {
      return NextResponse.json(
        { error: 'artworkId is required' },
        { status: 400 }
      )
    }

    const image = await updateGeneratedImage(id, {
      artwork_id: body.artworkId,
    })

    if (!image) {
      return NextResponse.json(
        { error: 'Image not found or update failed' },
        { status: 404 }
      )
    }

    return NextResponse.json({ image })
  } catch (error) {
    console.error('Error linking generated image:', error)
    return NextResponse.json(
      { error: 'Failed to link image to artwork' },
      { status: 500 }
    )
  }
}
