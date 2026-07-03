/**
 * One-shot: upload a folder of reference images to a style pack, mirroring
 * POST /api/style-packs/[id]/reference-image but bypassing HTTP/auth.
 *
 * For each image: upload to ai-generated/style-refs/<packId>/<uuid>.<ext>,
 * collect the public URL, then append all URLs to the pack's
 * referenceAssetPaths and upsert the style_packs row (same column shape as
 * lib/style-packs/db.ts upsertStylePack). Uploads all first; only mutates
 * the row if every upload succeeded.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/add-style-refs.mjs newyork-oil
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ADMIN_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(__dirname, '..', '..')

// Load .env the same way the other scripts do.
const envText = await fs.readFile(path.join(ADMIN_ROOT, '.env'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const packId = process.argv[2]
if (!packId) {
  console.error('Usage: node scripts/add-style-refs.mjs <packId>')
  process.exit(1)
}

const ART_DIR = path.join(REPO_ROOT, 'arts', 'Ale Casanova')
const CROPPED_DIR = path.join(ART_DIR, 'cropped')
const BUCKET = 'ai-generated'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Build the upload set: every .jpg in the art dir, but swap in the cropped
// version for any file that has one.
const croppedNames = new Set(
  (await fs.readdir(CROPPED_DIR).catch(() => [])).filter((n) => n.endsWith('.jpg'))
)
const baseNames = (await fs.readdir(ART_DIR)).filter((n) => n.endsWith('.jpg')).sort()
const files = baseNames.map((name) => ({
  name,
  abs: croppedNames.has(name) ? path.join(CROPPED_DIR, name) : path.join(ART_DIR, name),
  cropped: croppedNames.has(name),
}))

console.log(`Pack: ${packId}`)
console.log(`Uploading ${files.length} images (${croppedNames.size} cropped, ${files.length - croppedNames.size} original)\n`)

// 1. Load current pack (DB row wins, else static JSON), same as the route.
const { data: row } = await supabase
  .from('style_packs')
  .select('id, enabled_for_launch, vectorizes_well, artist_id, is_primary, pack')
  .eq('id', packId)
  .maybeSingle()

let pack
if (row) {
  pack = {
    ...row.pack,
    id: row.id,
    enabledForLaunch: row.enabled_for_launch,
    vectorizesWell: row.vectorizes_well,
    isPrimary: row.is_primary,
    persona: row.artist_id
      ? { ...row.pack.persona, userId: row.artist_id }
      : row.pack.persona,
  }
} else {
  pack = JSON.parse(
    await fs.readFile(path.join(ADMIN_ROOT, 'lib', 'style-packs', `${packId}.json`), 'utf8')
  )
}

const existing = pack.referenceAssetPaths ?? []
console.log(`Existing referenceAssetPaths: ${existing.length}`)
if (existing.some((u) => u.includes(`/style-refs/${packId}/`))) {
  console.error('\nAbort: this pack already has uploaded style-refs. Re-running would duplicate them.')
  process.exit(1)
}

// 2. Upload every file first; abort before mutating if any fails.
const newUrls = []
for (const f of files) {
  const buf = await fs.readFile(f.abs)
  const storagePath = `style-refs/${packId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: false })
  if (error) {
    console.error(`\nUpload failed for ${f.name}: ${error.message}`)
    console.error('No DB changes made. Fix and re-run.')
    process.exit(1)
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  newUrls.push(data.publicUrl)
  console.log(`  ok  ${f.cropped ? '[cropped] ' : ''}${f.name}`)
}

// 3. Append and upsert (same column shape as upsertStylePack).
const paths = [...existing, ...newUrls]
pack.referenceAssetPaths = paths

const { error: upErr } = await supabase.from('style_packs').upsert({
  id: pack.id,
  enabled_for_launch: pack.enabledForLaunch,
  vectorizes_well: pack.vectorizesWell,
  artist_id: pack.persona.userId || null,
  is_primary: pack.isPrimary ?? true,
  pack,
})
if (upErr) {
  console.error(`\nRow upsert failed: ${upErr.message}`)
  console.error('Images were uploaded to storage but referenceAssetPaths was NOT updated.')
  process.exit(1)
}

console.log(`\nDone. referenceAssetPaths: ${existing.length} -> ${paths.length}`)
