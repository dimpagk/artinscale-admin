/**
 * One-shot upscale of a generated_image, mirroring what the
 * /api/art-generator/[id]/upscale route does — but bypasses HTTP/auth so
 * it can be driven from a CLI without admin login flow.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/upscale-one.mjs <generated_image_id> [scale=4]
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const id = process.argv[2]
const scale = Number(process.argv[3] ?? 4)
if (!id) {
  console.error('Usage: node scripts/upscale-one.mjs <generated_image_id> [scale]')
  process.exit(1)
}

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN
if (!REPLICATE_TOKEN) {
  console.error('REPLICATE_API_TOKEN missing')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Fetch the row
const { data: row, error: rowErr } = await supabase
  .from('generated_images')
  .select('id, image_url, metadata')
  .eq('id', id)
  .single()
if (rowErr || !row) {
  console.error('Not found:', rowErr?.message)
  process.exit(1)
}
console.log(`Original: ${row.image_url}`)

// Start prediction via Replicate's model-name endpoint (no SHA pinning)
console.log('Starting Replicate Real-ESRGAN…')
const startRes = await fetch(
  'https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions',
  {
    method: 'POST',
    headers: {
      Authorization: `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { image: row.image_url, scale, face_enhance: false },
    }),
  }
)
if (!startRes.ok) {
  console.error(`Replicate start ${startRes.status}: ${await startRes.text()}`)
  process.exit(1)
}
const start = await startRes.json()
console.log(`Prediction id: ${start.id}, status: ${start.status}`)

// Poll
let prediction = start
const t0 = Date.now()
while (
  prediction.status === 'starting' ||
  prediction.status === 'processing'
) {
  await new Promise((r) => setTimeout(r, 2500))
  const r = await fetch(prediction.urls.get, {
    headers: { Authorization: `Token ${REPLICATE_TOKEN}` },
  })
  prediction = await r.json()
  process.stdout.write(`\r  ${prediction.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)…    `)
}
process.stdout.write('\n')
if (prediction.status !== 'succeeded') {
  console.error('Prediction failed:', prediction.status, prediction.error)
  process.exit(1)
}
console.log(`Output URL: ${prediction.output}`)

// Download
const outRes = await fetch(prediction.output)
if (!outRes.ok) {
  console.error(`Download ${outRes.status}`)
  process.exit(1)
}
const buf = Buffer.from(await outRes.arrayBuffer())
console.log(`Downloaded ${(buf.length / 1024).toFixed(0)} KB`)

// Upload to Supabase Storage
const origPath = new URL(row.image_url).pathname.split('/').pop() ?? `${id}.png`
const upPath = `upscaled/${origPath}`
const { error: upErr } = await supabase.storage
  .from('ai-generated')
  .upload(upPath, buf, { contentType: 'image/png', upsert: true })
if (upErr) {
  console.error('Upload:', upErr.message)
  process.exit(1)
}
const { data: pub } = supabase.storage.from('ai-generated').getPublicUrl(upPath)
console.log(`Uploaded to: ${pub.publicUrl}`)

// Get dimensions via sharp
let width, height
try {
  const sharp = (await import('sharp')).default
  const meta = await sharp(buf).metadata()
  width = meta.width
  height = meta.height
} catch {
  // ignore — leave dimensions empty
}

// Update generated_image row metadata
const newMeta = {
  ...(row.metadata ?? {}),
  upscaledImageUrl: pub.publicUrl,
  upscaledDimensions: width && height ? { width, height } : undefined,
  upscaledScale: scale,
  upscaledAt: new Date().toISOString(),
}
const { error: updErr } = await supabase
  .from('generated_images')
  .update({ metadata: newMeta })
  .eq('id', id)
if (updErr) {
  console.error('Metadata update:', updErr.message)
  process.exit(1)
}

console.log(`\nDone. ${width ? `${width}×${height}` : 'unknown size'} upscaled image saved.`)
