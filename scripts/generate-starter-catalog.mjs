/**
 * Starter catalog generator.
 *
 * Generates one image per (style pack × topic) combination, uploads to
 * Supabase Storage, inserts a `generated_images` row. Does NOT promote
 * to artworks — that's the operator's curation step.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/generate-starter-catalog.mjs
 *
 * Env required (already in .env): GOOGLE_GEMINI_API_KEY,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Load .env (simple parser — no dep)
const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const GEMINI_KEY = process.env.GOOGLE_GEMINI_API_KEY
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!GEMINI_KEY || !SB_URL || !SB_SVC) {
  console.error('Missing GOOGLE_GEMINI_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const STYLE_PACKS = [
  { file: 'risograph-pulse.json', artistId: '00000000-0000-0000-0000-000000000a01' },
  { file: 'linework-meridian.json', artistId: '00000000-0000-0000-0000-000000000a02' },
  { file: 'bauhaus-prime.json', artistId: '00000000-0000-0000-0000-000000000a03' },
]

// Subjects matched to each (style, topic) pair — written to play to each
// artist's strengths and the topic's emotional weight.
const PLAN = [
  { stylePackFile: 'risograph-pulse.json', topicId: 'breath', subject: 'a single deer at dusk caught mid-exhale, fog softening the field around it' },
  { stylePackFile: 'risograph-pulse.json', topicId: 'genesis', subject: 'two hands cradling a small flame, one passing it to the other' },
  { stylePackFile: 'risograph-pulse.json', topicId: 'survive', subject: 'a sparrow standing on a snow-covered windowsill at dawn' },
  { stylePackFile: 'linework-meridian.json', topicId: 'breath', subject: 'a runner mid-stride at sunrise, contour silhouetted against sky' },
  { stylePackFile: 'linework-meridian.json', topicId: 'genesis', subject: 'a single tree alone in a field, every branch deliberate' },
  { stylePackFile: 'linework-meridian.json', topicId: 'survive', subject: 'two figures back to back, the line where they meet steady and unbroken' },
  { stylePackFile: 'bauhaus-prime.json', topicId: 'breath', subject: 'the moment a stone breaks the surface of still water — geometry of impact' },
  { stylePackFile: 'bauhaus-prime.json', topicId: 'genesis', subject: 'a single circle of warm light against a dark vertical plane — the first opening' },
  { stylePackFile: 'bauhaus-prime.json', topicId: 'survive', subject: 'three loaded geometric forms holding each other up against gravity' },
]

function buildStyledPrompt(pack, subject) {
  return [
    `Style: ${pack.prompt.master}`,
    `Palette: strict adherence to these hex colors only — ${pack.palette.colors.join(', ')}. ${pack.palette.description}`,
    `Composition: ${pack.composition.subjectPlacement}, at most ${pack.composition.maxSubjects} primary subject(s). ${pack.composition.notes}`,
    `Subject: ${subject}`,
    `Avoid: ${pack.prompt.negative}`,
  ].join('\n\n')
}

async function generateImage(prompt) {
  const genAI = new GoogleGenerativeAI(GEMINI_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' })
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  })
  const parts = result.response.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => p.inlineData)
  if (!imagePart?.inlineData?.data) {
    throw new Error(`No image returned. Parts: ${JSON.stringify(parts.map((p) => Object.keys(p)))}`)
  }
  return Buffer.from(imagePart.inlineData.data, 'base64')
}

async function uploadToStorage(buffer) {
  const now = new Date()
  const yr = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const storagePath = `${yr}/${mo}/${crypto.randomUUID()}.png`

  const res = await fetch(
    `${SB_URL}/storage/v1/object/ai-generated/${storagePath}`,
    {
      method: 'POST',
      headers: {
        'apikey': SB_SVC,
        'Authorization': `Bearer ${SB_SVC}`,
        'Content-Type': 'image/png',
      },
      body: buffer,
    }
  )
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`)
  return {
    storagePath,
    publicUrl: `${SB_URL}/storage/v1/object/public/ai-generated/${storagePath}`,
  }
}

async function insertGeneratedImageRow({ prompt, fullPrompt, publicUrl, storagePath, topicId, stylePackId, personaUserId }) {
  const res = await fetch(`${SB_URL}/rest/v1/generated_images`, {
    method: 'POST',
    headers: {
      'apikey': SB_SVC,
      'Authorization': `Bearer ${SB_SVC}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      prompt,
      edit_history: [],
      model: 'flash',
      aspect_ratio: '1:1',
      style_preset: null,
      image_url: publicUrl,
      storage_path: storagePath,
      topic_id: topicId,
      artwork_id: null,
      metadata: {
        fullPrompt,
        stylePackId,
        stylePackPersonaUserId: personaUserId,
        referenceImageCount: 0,
        source: 'starter_catalog',
      },
    }),
  })
  if (!res.ok) throw new Error(`insert failed: ${res.status} ${await res.text()}`)
  const [row] = await res.json()
  return row
}

async function main() {
  console.log(`Generating ${PLAN.length} starter catalog pieces…\n`)

  const results = []
  for (const item of PLAN) {
    const packPath = path.join(ROOT, 'lib/style-packs', item.stylePackFile)
    const pack = JSON.parse(await fs.readFile(packPath, 'utf8'))
    const fullPrompt = buildStyledPrompt(pack, item.subject)

    console.log(`▸ ${pack.persona.name} × ${item.topicId}: "${item.subject.slice(0, 60)}…"`)
    const t0 = Date.now()
    try {
      const png = await generateImage(fullPrompt)
      const { storagePath, publicUrl } = await uploadToStorage(png)
      const row = await insertGeneratedImageRow({
        prompt: item.subject,
        fullPrompt,
        publicUrl,
        storagePath,
        topicId: item.topicId,
        stylePackId: pack.id,
        personaUserId: pack.persona.userId,
      })
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`  ✓ ${elapsed}s · ${row.id}`)
      console.log(`    ${publicUrl}`)
      results.push({ ok: true, id: row.id, url: publicUrl, ...item })
    } catch (err) {
      console.error(`  ✗ failed: ${err.message}`)
      results.push({ ok: false, error: err.message, ...item })
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`Succeeded: ${results.filter((r) => r.ok).length}/${results.length}`)
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  ✗ ${r.stylePackFile} × ${r.topicId}: ${r.error}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
