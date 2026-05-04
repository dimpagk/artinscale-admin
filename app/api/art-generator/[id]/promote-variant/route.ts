import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { renderSvgToPng } from '@/lib/svg-render'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { getGeneratedImageById } from '@/lib/generated-images'
import { createArtwork, getArtworkById } from '@/lib/artworks'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Promote a vector variant to a print-ready artwork.
 *
 * Two-step server flow:
 *   1. Fetch the variant SVG from storage
 *   2. Render to a high-res PNG via sharp (default 4096px wide)
 *   3. Upload PNG to ai-generated bucket
 *   4. Insert an `artworks` row whose `image_url` points at the PNG
 *
 * The result is a Gelato-pushable artwork that carries the vector
 * provenance (we keep both the SVG storage path and the rendered PNG
 * URL on the artwork for audit + future re-renders at higher res).
 *
 * POST /api/art-generator/{generatedImageId}/promote-variant
 *   body: {
 *     variant_index: number          (which entry in metadata.vector.variants)
 *     title?: string
 *     edition_size?: number
 *     price?: number
 *     currency?: string
 *     render_width?: number          (defaults 4096)
 *   }
 *
 * Returns: { artwork }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: {
    variant_index?: number
    title?: string
    edition_size?: number
    price?: number
    currency?: string
    render_width?: number
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.variant_index !== 'number' || body.variant_index < 0) {
    return NextResponse.json({ error: 'variant_index (number) required' }, { status: 400 })
  }

  const image = await getGeneratedImageById(id)
  if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  const meta = image.metadata as Record<string, unknown> | null
  const vector = meta?.vector as
    | {
        variants?: Array<{ paletteName: string; paletteHex: string[]; svgUrl: string; svgStoragePath: string }>
      }
    | undefined
  const variant = vector?.variants?.[body.variant_index]
  if (!variant) {
    return NextResponse.json(
      { error: `No variant at index ${body.variant_index}` },
      { status: 404 }
    )
  }

  // Fetch the SVG content (it's a public URL, no auth needed)
  const svgRes = await fetch(variant.svgUrl)
  if (!svgRes.ok) {
    return NextResponse.json(
      { error: `Could not fetch variant SVG: ${svgRes.status}` },
      { status: 502 }
    )
  }
  const svg = await svgRes.text()

  // Render to PNG via sharp
  let rendered
  try {
    rendered = await renderSvgToPng({
      svg,
      width: body.render_width ?? 4096,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'SVG render failed' },
      { status: 500 }
    )
  }

  // Upload PNG to storage
  const baseDir = image.storage_path.replace(/\.png$/, '')
  const pngPath = `${baseDir}.variant-${body.variant_index}-${crypto.randomBytes(3).toString('hex')}.png`
  await uploadFile('ai-generated', pngPath, rendered.buffer, {
    contentType: 'image/png',
  })
  const pngUrl = getPublicUrl('ai-generated', pngPath)

  // Inherit artist + topic from the original generated image
  const artistId = (meta?.stylePackPersonaUserId as string | undefined) ?? null
  const topicId = image.topic_id ?? null

  const titleFromInput = body.title?.trim()
  const titleFromPrompt = image.prompt
    .split(/[,.;]/)[0]
    .trim()
    .slice(0, 80)
    .replace(/^./, (c) => c.toUpperCase())
  const finalTitle = titleFromInput || `${titleFromPrompt} — ${variant.paletteName}`

  try {
    await createArtwork({
      title: finalTitle,
      description: `Vector variant: ${variant.paletteName}. Rendered at ${rendered.width}×${rendered.height}px.`,
      image_url: pngUrl,
      artist_id: artistId,
      topic_id: topicId,
      status: 'created',
      edition_size: body.edition_size ?? null,
      price: body.price ?? null,
      currency: body.currency ?? 'EUR',
      product_type: 'poster',
      inspiration_summary: image.prompt,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // Look up the artwork we just inserted
  const { data: latest } = await supabaseAdmin
    .from('artworks')
    .select('*, users(id, name, image, bio), topics(id, title)')
    .eq('image_url', pngUrl)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!latest) {
    return NextResponse.json(
      { error: 'Artwork created but could not be retrieved' },
      { status: 500 }
    )
  }

  const artwork = latest as { id: string }

  // Stamp the artwork's metadata via direct update so vector provenance
  // is preserved (createArtwork doesn't expose a metadata field).
  await supabaseAdmin
    .from('artworks')
    .update({
      // Keep image_url as PNG (Gelato-ready). Vector provenance lives in
      // inspiration_summary or a future metadata column.
      inspiration_summary: `${image.prompt}\n\nVector variant — palette: ${variant.paletteHex.join(', ')}`,
    })
    .eq('id', artwork.id)

  // Backlink the generated image so we don't double-promote
  await supabaseAdmin
    .from('generated_images')
    .update({ artwork_id: artwork.id })
    .eq('id', id)

  return NextResponse.json({
    artwork: await getArtworkById(artwork.id),
    rendered: {
      width: rendered.width,
      height: rendered.height,
      url: pngUrl,
    },
  })
}
