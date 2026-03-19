import { NextResponse } from 'next/server'
import { getGeneratedImages } from '@/lib/generated-images'
import type { GeneratedImageFilters } from '@/lib/constants/art-generator'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const filters: GeneratedImageFilters = {}

    const topicId = searchParams.get('topic_id')
    if (topicId) filters.topic_id = topicId

    const artworkId = searchParams.get('artwork_id')
    if (artworkId) filters.artwork_id = artworkId

    const limit = searchParams.get('limit')
    if (limit) filters.limit = parseInt(limit, 10)

    const offset = searchParams.get('offset')
    if (offset) filters.offset = parseInt(offset, 10)

    const images = await getGeneratedImages(filters)

    return NextResponse.json({ images })
  } catch (error) {
    console.error('Error listing generated images:', error)
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    )
  }
}
