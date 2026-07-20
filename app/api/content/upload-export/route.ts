import { NextResponse } from 'next/server'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Upload exported social-post PNGs (rendered client-side from
 * Content Studio's canvas) to Supabase Storage and stamp the public
 * URLs onto the post's `visual_config.exported_image_urls`.
 *
 * The route is admin-gated by the existing middleware (admin role
 * required for any non-_next path). Inputs:
 *
 *   social_post_id: string
 *   images[]: File         (one per carousel slide, in order)
 *
 * Storage layout:
 *   ai-generated://social-exports/<post-id>/<timestamp>-slide-<n>.png
 *
 * The same post can be re-uploaded; old URLs are overwritten on the
 * post row but the underlying storage objects are kept (timestamps
 * differ) — useful as an audit trail of what was published.
 */

const MAX_FILES = 10
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024 // 8 MB

export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Body must be multipart/form-data' }, { status: 400 })
  }

  const socialPostId = form.get('social_post_id')
  if (typeof socialPostId !== 'string' || !socialPostId) {
    return NextResponse.json({ error: 'social_post_id is required' }, { status: 400 })
  }

  const images = form.getAll('images')
  if (images.length === 0) {
    return NextResponse.json({ error: 'At least one image is required' }, { status: 400 })
  }
  if (images.length > MAX_FILES) {
    return NextResponse.json(
      { error: `At most ${MAX_FILES} images per upload (got ${images.length}).` },
      { status: 400 }
    )
  }

  // Per-slide mode: the client uploads one slide per request (large 2x
  // renders in a single multipart body exceed the dev middleware's 10 MB
  // cap and Vercel's ~4.5 MB serverless limit). slide_index is 1-based;
  // the slide's URL is merged into exported_image_urls at that position.
  const slideIndexRaw = form.get('slide_index')
  const slideCountRaw = form.get('slide_count')
  const slideIndex = typeof slideIndexRaw === 'string' ? parseInt(slideIndexRaw, 10) : null
  const slideCount = typeof slideCountRaw === 'string' ? parseInt(slideCountRaw, 10) : null
  const perSlide = slideIndex !== null && slideCount !== null
  if (perSlide) {
    if (
      !Number.isInteger(slideIndex) || !Number.isInteger(slideCount) ||
      slideCount < 1 || slideCount > MAX_FILES ||
      slideIndex < 1 || slideIndex > slideCount
    ) {
      return NextResponse.json(
        { error: `Invalid slide_index/slide_count (${slideIndexRaw}/${slideCountRaw}).` },
        { status: 400 }
      )
    }
    if (images.length !== 1) {
      return NextResponse.json(
        { error: `Per-slide mode expects exactly one image (got ${images.length}).` },
        { status: 400 }
      )
    }
  }

  // Confirm the post exists before we waste storage on uploads.
  const { data: existingPost, error: fetchError } = await supabaseAdmin
    .from('social_posts')
    .select('id, visual_config')
    .eq('id', socialPostId)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: `Lookup failed: ${fetchError.message}` }, { status: 500 })
  }
  if (!existingPost) {
    return NextResponse.json({ error: 'social_post not found' }, { status: 404 })
  }

  const timestamp = Date.now()
  const urls: string[] = []

  for (let i = 0; i < images.length; i++) {
    const entry = images[i]
    // FormDataEntryValue is `string | File`; reject the string case first
    // so the rest of the body can treat `file` as File without nullable casts.
    if (typeof entry === 'string') {
      return NextResponse.json(
        { error: `images[${i}] is a string, expected a file upload` },
        { status: 400 }
      )
    }
    const file = entry
    if (file.size > MAX_BYTES_PER_FILE) {
      return NextResponse.json(
        { error: `images[${i}] too large (${file.size} bytes, max ${MAX_BYTES_PER_FILE}).` },
        { status: 400 }
      )
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const isJpeg = file.type === 'image/jpeg'
    const slideNo = perSlide ? slideIndex : i + 1
    const path = `social-exports/${socialPostId}/${timestamp}-slide-${slideNo}.${isJpeg ? 'jpg' : 'png'}`

    try {
      await uploadFile('ai-generated', path, buf, {
        contentType: isJpeg ? 'image/jpeg' : 'image/png',
        upsert: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { error: `storage upload failed at slide ${i + 1}: ${message}` },
        { status: 500 }
      )
    }
    urls.push(getPublicUrl('ai-generated', path))
  }

  const existingConfig = (existingPost as { visual_config: Record<string, unknown> }).visual_config ?? {}
  // Per-slide mode merges into the existing array at the slide's
  // position (client uploads sequentially, so no write races); a fresh
  // export run resets the array when its length no longer matches.
  let mergedUrls = urls
  if (perSlide) {
    const prior = existingConfig.exported_image_urls
    const base =
      Array.isArray(prior) && prior.length === slideCount
        ? [...(prior as (string | null)[])]
        : new Array<string | null>(slideCount).fill(null)
    base[slideIndex - 1] = urls[0]
    mergedUrls = base.filter((u): u is string => typeof u === 'string')
    // Keep positions stable while some slides are still uploading: only
    // collapse nulls once every slot is filled.
    if (mergedUrls.length !== slideCount) {
      mergedUrls = base as string[]
    }
  }
  const updatedVisualConfig = {
    ...existingConfig,
    exported_image_urls: mergedUrls,
    exported_at: new Date().toISOString(),
  }

  const { error: updateError } = await supabaseAdmin
    .from('social_posts')
    .update({ visual_config: updatedVisualConfig })
    .eq('id', socialPostId)

  if (updateError) {
    return NextResponse.json(
      { error: `social_posts update failed: ${updateError.message}` },
      { status: 500 }
    )
  }

  // Return the merged list (equals `urls` in batch mode) so the client's
  // final per-slide response carries the complete, ordered export set.
  return NextResponse.json({ urls: mergedUrls })
}
