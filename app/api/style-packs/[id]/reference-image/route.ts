import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { uploadFile, getPublicUrl, deleteFile } from '@/lib/storage'
import { fetchStylePackFromDb, upsertStylePack } from '@/lib/style-packs/db'
import { getStylePack } from '@/lib/style-packs'

/**
 * Reference images for a style pack.
 *
 * Photos an operator uploads to show what an artist's voice looks like.
 * They're stored under a `style-refs/` prefix in the public `ai-generated`
 * bucket and their URLs kept on the pack's `referenceAssetPaths`. The
 * generate route already feeds these to Gemini as reference images (via
 * loadExemplars' static fallback), so uploaded photos sharpen the style,
 * especially for a brand-new pack that has no approved exemplars yet.
 *
 * POST   multipart form-data { file }        -> append one image
 * DELETE json { url }                        -> remove one image
 * Both return { paths } (the updated referenceAssetPaths).
 */

// Vercel serverless caps the request body around 4.5 MB; stay under it and
// give a clear error rather than a truncated upload.
const MAX_BYTES = 4_000_000

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

async function loadPack(id: string) {
  return (await fetchStylePackFromDb(id)) ?? getStylePack(id)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const pack = await loadPack(id)
  if (!pack) {
    return NextResponse.json({ error: 'Style pack not found' }, { status: 404 })
  }

  let file: File | null = null
  try {
    const form = await request.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: 'Expected multipart form-data' }, { status: 400 })
  }

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Image too large (max ~4 MB). Please downscale it first.' },
      { status: 400 }
    )
  }

  const ext = EXT_BY_TYPE[file.type] ?? 'png'
  const storagePath = `style-refs/${id}/${randomUUID()}.${ext}`

  try {
    await uploadFile('ai-generated', storagePath, file, { contentType: file.type })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[reference-image] upload failed:', message)
    return NextResponse.json({ error: `Upload failed: ${message}` }, { status: 500 })
  }

  const url = getPublicUrl('ai-generated', storagePath)
  const paths = [...(pack.referenceAssetPaths ?? []), url]

  await upsertStylePack({ ...pack, referenceAssetPaths: paths })
  revalidatePath(`/styles/${id}`)

  return NextResponse.json({ paths })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const pack = await loadPack(id)
  if (!pack) {
    return NextResponse.json({ error: 'Style pack not found' }, { status: 404 })
  }

  let url: string | undefined
  try {
    const body = (await request.json()) as { url?: string }
    url = body.url
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!url) {
    return NextResponse.json({ error: 'body.url is required' }, { status: 400 })
  }

  const paths = (pack.referenceAssetPaths ?? []).filter((p) => p !== url)
  await upsertStylePack({ ...pack, referenceAssetPaths: paths })

  // Best-effort removal of the underlying object when it's one of ours.
  const marker = '/ai-generated/'
  if (url.includes(marker)) {
    const objectPath = url.split(marker)[1]?.split('?')[0]
    if (objectPath) {
      try {
        await deleteFile('ai-generated', objectPath)
      } catch (err) {
        console.warn('[reference-image] storage delete failed (non-fatal):', err)
      }
    }
  }

  revalidatePath(`/styles/${id}`)
  return NextResponse.json({ paths })
}
