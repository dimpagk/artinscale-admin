/**
 * Emil Varga's 12 Field Notation print masters -> Supabase.
 *
 * Default: upload the masters to the public `artworks` storage bucket and
 * print their public URLs.
 *
 * With --create-artworks: also create one `artworks` row per master (draft
 * status 'created', artist Emil Varga, open edition, 59 EUR). This does NOT
 * touch Shopify/Gelato — those pushes stay in the admin. Idempotent by
 * image_url: re-running updates the existing row instead of duplicating.
 *
 * The masters are the deterministic 40x50 cm / 300 dpi PNGs produced by
 * ../../generative/field-notation/node (see collections/field-notation.md).
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/upload-field-notation-masters.mjs                    # upload only
 *   node scripts/upload-field-notation-masters.mjs --create-artworks  # upload + rows
 *   node scripts/upload-field-notation-masters.mjs --create-artworks --price 69
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

// Flags
const args = process.argv.slice(2)
const CREATE_ROWS = args.includes('--create-artworks')
const priceIdx = args.indexOf('--price')
const PRICE = priceIdx >= 0 ? Number(args[priceIdx + 1]) : 59

// Emil Varga — pinned studio persona (sql/047_seed_emil_varga_artist.sql).
const ARTIST_ID = '00000000-0000-0000-0000-000000000a10'

// The chosen edition, in catalog order (see collections/field-notation.md).
// Note doubles as the artwork description (gallery caption).
const PIECES = [
  { seed: 13,   note: 'A low sun held left of center; the field gathers, darkens, and slips from the frame in a single line.' },
  { seed: 10,   note: 'The field parts and pours downward, leaving one fine thread trailing beneath the disc.' },
  { seed: 14,   note: 'Reeds rise in near symmetry under a crowned sun. The quietest of the twelve.' },
  { seed: 20,   note: 'Soft currents lift and divide around a centered void.' },
  { seed: 165,  note: 'Warmth spreads from the upper left into open, unworked paper.' },
  { seed: 3013, note: 'A crowned disc set high, with one long diagonal current drawn down the left.' },
  { seed: 3,    note: 'Branching lines climb like bare growth beneath the sun.' },
  { seed: 156,  note: 'The disc sits to the right; warmth clings to its edge while the left stays open.' },
  { seed: 16,   note: 'Dark, high-contrast currents. The statement of the set.' },
  { seed: 409,  note: 'The field wraps the void in a slow turning, more drawn than grown.' },
  { seed: 3024, note: 'A full crown of warmth over a low, cradling sweep.' },
  { seed: 825,  note: 'A disc set high left, its warmth carried off to the right like a tail.' },
]

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
for (const { seed } of PIECES) {
  const abs = path.join(MASTERS_DIR, fileFor(seed))
  try {
    const stat = await fs.stat(abs)
    files.push({ seed, abs, bytes: stat.size })
  } catch {
    console.error(`Missing master for ${pad(seed)}: ${abs}`)
    console.error('Render the masters first:')
    console.error(
      '  cd ../generative/field-notation/node && node render.js masters ' +
        PIECES.map((p) => p.seed).join(',') +
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
    note: PIECES[i].note,
    path: storagePath,
    url: data.publicUrl,
  })
  console.log(`  ok  ${String(i + 1).padStart(2, '0')}  ${pad(seed)}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
}

// 3. Write the manifest.
await fs.writeFile(
  MANIFEST,
  JSON.stringify(
    results.map(({ index, seed, title, path: p, url }) => ({ index, seed, title, path: p, url })),
    null,
    2
  ) + '\n'
)
console.log(`\nManifest written: ${path.relative(REPO_ROOT, MANIFEST)}`)

// 4. Optionally create/update the artworks rows.
if (CREATE_ROWS) {
  console.log(`\nCreating artworks rows (artist Emil Varga, open edition, ${PRICE} EUR)…\n`)

  // Confirm the artist row exists before writing 12 rows against it.
  const { data: artist, error: artistErr } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', ARTIST_ID)
    .maybeSingle()
  if (artistErr) {
    console.error(`Could not look up artist: ${artistErr.message}`)
    process.exit(1)
  }
  if (!artist) {
    console.error(`Artist ${ARTIST_ID} not found. Run sql/047_seed_emil_varga_artist.sql first.`)
    process.exit(1)
  }

  let created = 0
  let updated = 0
  for (const r of results) {
    const base = {
      title: r.title,
      description: r.note,
      artist_id: ARTIST_ID,
      price: PRICE,
      currency: 'EUR',
      edition_size: null, // open edition
      creation_source: 'manual', // deterministic code, not the AI pipeline
    }

    // Idempotent by image_url: our storage path is stable per seed.
    const { data: existing, error: selErr } = await supabase
      .from('artworks')
      .select('id')
      .eq('image_url', r.url)
      .maybeSingle()
    if (selErr) {
      console.error(`  lookup failed for ${pad(r.seed)}: ${selErr.message}`)
      process.exit(1)
    }

    if (existing) {
      const { error } = await supabase.from('artworks').update(base).eq('id', existing.id)
      if (error) {
        console.error(`  update failed for ${pad(r.seed)}: ${error.message}`)
        process.exit(1)
      }
      updated++
      console.log(`  upd  ${pad(r.seed)}  ${existing.id}`)
    } else {
      const { data: ins, error } = await supabase
        .from('artworks')
        .insert({
          ...base,
          image_url: r.url,
          topic_id: null,
          status: 'created', // draft; nothing is pushed to Shopify/Gelato
          edition_sold: 0,
        })
        .select('id')
        .single()
      if (error) {
        console.error(`  insert failed for ${pad(r.seed)}: ${error.message}`)
        process.exit(1)
      }
      created++
      console.log(`  new  ${pad(r.seed)}  ${ins.id}`)
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated. All drafts (status 'created').`)
  console.log('Review in the admin, then push each to Gelato/Shopify when ready.')
} else {
  console.log('\n| # | Seed | Title | Public URL |')
  console.log('|---|------|-------|------------|')
  for (const r of results) {
    console.log(`| ${r.index} | ${pad(r.seed)} | ${r.title} | ${r.url} |`)
  }
  console.log('\nRe-run with --create-artworks to also create the draft artworks rows.')
}
