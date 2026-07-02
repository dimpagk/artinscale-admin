/**
 * Generate the mockup-scene library defined in lib/mockup-scenes-catalog.mjs.
 *
 * Runs the existing Gemini text-to-image path for each scene, uploads
 * the result to Supabase Storage at `mockup-scenes/<key>.png`, and
 * skips scenes whose storage object already exists (idempotent re-run).
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/generate-mockup-scenes.mjs                  # generate all missing
 *   node scripts/generate-mockup-scenes.mjs --force          # regenerate everything
 *   node scripts/generate-mockup-scenes.mjs --only <key>     # one scene by key
 *
 * Env required: GOOGLE_GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY (read from .env, same as
 * generate-starter-catalog.mjs).
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'
import { MOCKUP_SCENES } from '../lib/mockup-scenes-catalog.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Load .env
const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// Args
const args = process.argv.slice(2)
const force = args.includes('--force')
const onlyIdx = args.indexOf('--only')
const onlyKey = onlyIdx >= 0 ? args[onlyIdx + 1] : null

if (MOCKUP_SCENES.length === 0) {
  console.error('No scenes in catalog')
  process.exit(1)
}
console.log(`Loaded ${MOCKUP_SCENES.length} scenes from catalog.`)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
// Nano Banana 2, verified working on this key via the art generator.
const MODEL_ID = 'gemini-3.1-flash-image'

const BUCKET = 'ai-generated'

async function objectExists(storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(path.dirname(storagePath), { search: path.basename(storagePath) })
  if (error) return false
  return data?.some((f) => f.name === path.basename(storagePath)) ?? false
}

async function generateScene(scene) {
  const storagePath = `mockup-scenes/${scene.key}.png`

  if (!force) {
    const exists = await objectExists(storagePath)
    if (exists) {
      console.log(`[skip] ${scene.key} — already exists at ${storagePath}`)
      return { skipped: true }
    }
  }

  console.log(`[gen ] ${scene.key} (${scene.aspectRatio})`)
  const t0 = Date.now()
  const model = genAI.getGenerativeModel({ model: MODEL_ID })
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: scene.prompt }] }],
  })

  const parts = result?.response?.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => p.inlineData)
  if (!imagePart) {
    console.error(`[fail] ${scene.key} — no inlineData in response`)
    return { failed: true }
  }

  const buf = Buffer.from(imagePart.inlineData.data, 'base64')
  const ms = Date.now() - t0
  console.log(`[upl ] ${scene.key} (${(buf.length / 1024).toFixed(0)} KB, ${ms}ms)`)

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: 'image/png',
      upsert: true,
    })
  if (upErr) {
    console.error(`[fail] ${scene.key} upload — ${upErr.message}`)
    return { failed: true }
  }

  return { generated: true, ms, bytes: buf.length }
}

const targets = onlyKey ? MOCKUP_SCENES.filter((s) => s.key === onlyKey) : MOCKUP_SCENES
if (targets.length === 0) {
  console.error(`No scene matches --only "${onlyKey}"`)
  process.exit(1)
}

let counts = { generated: 0, skipped: 0, failed: 0 }
for (const scene of targets) {
  const r = await generateScene(scene)
  if (r.generated) counts.generated++
  if (r.skipped) counts.skipped++
  if (r.failed) counts.failed++
}

console.log('\nDone.', counts)
