/**
 * One-shot: upload Emil Varga's 12 Field Notation print masters to the public
 * `artworks` storage bucket and collect their public URLs.
 *
 * The masters are the deterministic 40x50 cm / 300 dpi PNGs produced by
 * ../../generative/field-notation/node (see collections/field-notation.md).
 * This does NOT create artworks rows or touch Shopify/Gelato — it only lands
 * the image files in storage and prints the URLs, ready to paste into the
 * admin "New artwork" form (or to feed a follow-up row-creation step).
 *
 * Idempotent: upserts each object, so re-running overwrites in place. Writes a
 * small manifest (seed -> public URL) next to the collection doc for reference.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/upload-field-notation-masters.mjs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ADMIN_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(__dirname, '..', '..')

// Load .env the same way the other scripts do (no secrets echoed).
const envText = await fs.readFile(path.join(ADMIN_ROOT, '.env'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// The chosen edition, in catalog order (see collections/field-notation.md).
const SEEDS = [13, 10, 14, 20, 165, 3013, 3, 156, 16, 409, 3024, 825]

const MASTERS_DIR = path.join(REPO_ROOT, 'generative', 'field-notation', 'node', 'masters')
const MANIFEST = path.join(
  REPO_ROOT,
  'generative',
  'field-notation',
  'collections',
  'field-notation-masters.json'
)
const BUCKET = 'artworks'
const pad = (n) => 'S-' + String(n).padStart(6, '0')
const fileFor = (n) => `field-notation-s${String(n).padStart(6, '0')}-print-40x50-300dpi.png`

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// 1. Verify every master exists before uploading anything.
const files = []
for (const seed of SEEDS) {
  const abs = path.join(MASTERS_DIR, fileFor(seed))
  try {
    const stat = await fs.stat(abs)
    files.push({ seed, abs, bytes: stat.size })
  } catch {
    console.error(`Missing master for ${pad(seed)}: ${abs}`)
    console.error('Render the masters first:')
    console.error(
      '  cd ../generative/field-notation/node && node render.js masters ' +
        SEEDS.join(',') +
        ' --outdir ./masters'
    )
    process.exit(1)
  }
}

console.log(`Uploading ${files.length} masters to bucket "${BUCKET}/field-notation/"…\n`)

// 2. Upload each (upsert), collect public URLs.
const results = []
for (let i = 0; i < files.length; i++) {
  const { seed, abs, bytes } = files[i]
  const buf = await fs.readFile(abs)
  const storagePath = `field-notation/s${String(seed).padStart(6, '0')}.png`
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: 'image/png',
    cacheControl: '31536000',
    upsert: true,
  })
  if (error) {
    console.error(`\nUpload failed for ${pad(seed)}: ${error.message}`)
    console.error('Fix and re-run (upsert makes prior uploads safe to redo).')
    process.exit(1)
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  results.push({
    index: i + 1,
    seed,
    title: `Field Notation ${pad(seed)}`,
    path: storagePath,
    url: data.publicUrl,
  })
  console.log(`  ok  ${String(i + 1).padStart(2, '0')}  ${pad(seed)}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
}

// 3. Write the manifest and print a paste-ready table.
await fs.writeFile(MANIFEST, JSON.stringify(results, null, 2) + '\n')

console.log(`\nManifest written: ${path.relative(REPO_ROOT, MANIFEST)}\n`)
console.log('| # | Seed | Title | Public URL |')
console.log('|---|------|-------|------------|')
for (const r of results) {
  console.log(`| ${r.index} | ${pad(r.seed)} | ${r.title} | ${r.url} |`)
}
console.log(
  '\nNext: create an artworks row per URL (artist: Emil Varga), then push to Gelato/Shopify from the admin.'
)
