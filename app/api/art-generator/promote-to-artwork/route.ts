import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createArtwork, getArtworkById } from '@/lib/artworks'

/**
 * Promote a `generated_images` row to a draft `artworks` row.
 *
 * POST /api/art-generator/promote-to-artwork
 *   body: {
 *     generated_image_id: string
 *     title?: string                  (defaults to a slice of the prompt)
 *     image_url: string
 *     artist_id?: string | null       (inferred from style pack persona)
 *     topic_id?: string | null
 *     product_type?: string           (defaults to 'poster')
 *     inspiration_summary?: string
 *   }
 *
 * Side effects:
 *   1. Inserts an `artworks` row in status=`created`
 *   2. Updates `generated_images.artwork_id` so the same image can't be
 *      promoted twice without explicit override
 *
 * Returns: { artwork: { id, ... } }
 */
export async function POST(request: Request) {
  let body: {
    generated_image_id?: string
    title?: string
    image_url?: string
    artist_id?: string | null
    topic_id?: string | null
    product_type?: string
    inspiration_summary?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.generated_image_id || !body.image_url) {
    return NextResponse.json(
      { error: 'generated_image_id and image_url are required' },
      { status: 400 }
    )
  }

  // Refuse to double-promote — already-linked generated_images need an
  // explicit override (delete the artwork first or use a different image).
  const { data: existingGen } = await supabaseAdmin
    .from('generated_images')
    .select('id, artwork_id')
    .eq('id', body.generated_image_id)
    .maybeSingle()

  const existingArtworkId = (existingGen as { artwork_id?: string | null } | null)?.artwork_id
  if (existingArtworkId) {
    const artwork = await getArtworkById(existingArtworkId)
    if (artwork) {
      return NextResponse.json({ artwork, alreadyExists: true })
    }
  }

  try {
    await createArtwork({
      title: body.title?.trim() || 'Untitled',
      description: null,
      image_url: body.image_url,
      artist_id: body.artist_id || null,
      topic_id: body.topic_id || null,
      status: 'created',
      product_type: body.product_type || 'poster',
      inspiration_summary: body.inspiration_summary || null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // Find the artwork we just inserted (createArtwork doesn't return id).
  const { data: latest } = await supabaseAdmin
    .from('artworks')
    .select('*, users(id, name, image, bio), topics(id, title)')
    .eq('image_url', body.image_url)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!latest) {
    return NextResponse.json(
      { error: 'Artwork created but could not be retrieved' },
      { status: 500 }
    )
  }

  // Backlink generated image → artwork
  await supabaseAdmin
    .from('generated_images')
    .update({ artwork_id: (latest as { id: string }).id })
    .eq('id', body.generated_image_id)

  return NextResponse.json({ artwork: latest })
}
