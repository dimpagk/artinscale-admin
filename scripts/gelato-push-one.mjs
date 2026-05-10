/**
 * One-shot Gelato push that mirrors `createGelatoProduct` in lib/gelato.ts
 * but runs from CLI so we can verify the template-flow contract without
 * routing through the admin UI / auth.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/gelato-push-one.mjs <artwork_id>
 *
 * Verifies (the whole point of this script):
 *   1. GET /v1/templates/{templateUid} returns variants[] with image
 *      placeholder names → the contract we discovered from the
 *      community SDK actually holds.
 *   2. POST /v1/stores/{storeId}/products creates a product with
 *      `variants: []` populated (not silently dropped as before).
 *
 * Reads .env directly so it doesn't need the Next.js runtime.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Load .env
const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const artworkId = process.argv[2]
if (!artworkId) {
  console.error('Usage: node scripts/gelato-push-one.mjs <artwork_id>')
  process.exit(1)
}

const GELATO_API_KEY = process.env.GELATO_API_KEY
const GELATO_STORE_ID = process.env.GELATO_STORE_ID
const GELATO_API_BASE = 'https://ecommerce.gelatoapis.com/v1'
if (!GELATO_API_KEY || !GELATO_STORE_ID) {
  console.error('GELATO_API_KEY or GELATO_STORE_ID missing')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Fetch artwork
const { data: artwork, error: artErr } = await supabase
  .from('artworks')
  .select('id, title, description, image_url, product_type, edition_size, edition_sold, topic_id, artist_id, inspiration_summary')
  .eq('id', artworkId)
  .single()
if (artErr || !artwork) {
  console.error('Artwork not found:', artErr?.message)
  process.exit(1)
}
console.log(`Artwork: "${artwork.title}" (${artwork.product_type})`)

// Find upscaled image URL
const { data: gen } = await supabase
  .from('generated_images')
  .select('metadata')
  .eq('image_url', artwork.image_url)
  .maybeSingle()
const upscaledUrl = gen?.metadata?.upscaledImageUrl
const sourceImageUrl = upscaledUrl ?? artwork.image_url
console.log(`Source image: ${sourceImageUrl}`)
if (gen?.metadata?.upscaledDimensions) {
  const d = gen.metadata.upscaledDimensions
  console.log(`Dimensions: ${d.width}x${d.height}`)
}

// Hardcode the template UIDs — same as lib/gelato-templates.ts (verified via API)
const TEMPLATE_UIDS = {
  'museum-poster-21x30': '07296bb6-304c-47db-8c38-f94445954270',
  'museum-poster-30x40': 'b1d870ea-1d24-43bd-b57e-d7b98924be96',
  'museum-poster-30x45': '3500d49c-47ef-429e-a0a2-4a1b7c72780c',
  'museum-poster-40x50': 'fe4c42d0-3a9b-4a02-8483-5fde5beeed4e',
  'museum-poster-50x70': 'c03ddd1d-fd24-4e52-ad1e-67c272f5bfdf',
  'museum-poster-60x90': 'ddf691be-4ba8-467d-aea3-3ee3a78b6b36',
  'museum-poster-70x100': '7f53f6f5-078d-4e58-81fb-f2e74b22020b',
}

const templateUid = TEMPLATE_UIDS[artwork.product_type]
if (!templateUid) {
  console.error(`No template UID configured for product_type "${artwork.product_type}"`)
  process.exit(1)
}
console.log(`Template UID: ${templateUid}`)

// Step 1: GET template
console.log('\n=== Step 1: GET template ===')
const tmplRes = await fetch(`${GELATO_API_BASE}/templates/${templateUid}`, {
  headers: { 'X-API-KEY': GELATO_API_KEY },
})
if (!tmplRes.ok) {
  console.error(`Template GET ${tmplRes.status}: ${await tmplRes.text()}`)
  process.exit(1)
}
const template = await tmplRes.json()
console.log(`Template variants: ${template.variants?.length ?? 0}`)
for (const v of template.variants ?? []) {
  console.log(`  variant ${v.id}: title="${v.title}", productUid=${v.productUid}`)
  for (const ph of v.imagePlaceholders ?? []) {
    console.log(`    placeholder: name="${ph.name}", printArea=${ph.printArea}, ${ph.width}x${ph.height}`)
  }
}

// Step 2: build variants payload
const variantsPayload = template.variants.map((v) => ({
  templateVariantId: v.id,
  position: 0,
  imagePlaceholders: v.imagePlaceholders.map((ph) => ({
    name: ph.name,
    fileUrl: sourceImageUrl,
    fitMethod: 'slice',
  })),
}))

// Build description + tags inline (mirrors lib/product-copy.ts roughly)
const editionLabel = artwork.edition_size != null
  ? `${artwork.edition_sold ?? 0} of ${artwork.edition_size}`
  : 'Open edition'
const cmStr = '21x30 cm'
const inchStr = '8x12″'
const description = `<p>${artwork.description ?? ''}</p>\n<p>${artwork.inspiration_summary ?? ''}</p>\n<p><strong>Edition:</strong> ${editionLabel}<br/><strong>Size:</strong> ${cmStr} (${inchStr})<br/><strong>Paper:</strong> Museum-Quality Matte 250gsm</p>`
const tags = ['illustration', 'museum-matte', 'archival-print', 'limited-edition', artwork.topic_id, '21x30'].filter(Boolean)
const variantTitle = `${cmStr} / ${inchStr} - Vertical`

const metadata = [
  { key: 'publishImmediately', value: 'true' },
  { key: 'publishWithFreeShipping', value: 'false' },
  { key: 'previewFileType', value: 'webp' },
  { key: 'usedStandardMockup', value: '1' },
  { key: 'publishScopes', value: '["product"]' },
  { key: 'publishMode', value: 'bulk_edit' },
]

const productPayload = {
  templateId: templateUid,
  title: artwork.title,
  description,
  // Use the create-from-template documented field
  isVisibleInTheOnlineStore: true,
  salesChannels: ['web'],
  tags,
  metadata,
  variants: variantsPayload,
}

console.log('\n=== Step 2: POST product (create-from-template) ===')
const productUrl = `${GELATO_API_BASE}/stores/${GELATO_STORE_ID}/products:create-from-template`
console.log(`POST ${productUrl}`)
console.log(`payload variants: ${productPayload.variants.length}`)

const postRes = await fetch(productUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': GELATO_API_KEY,
    },
    body: JSON.stringify(productPayload),
})

const postBody = await postRes.text()
console.log(`Response: ${postRes.status} ${postRes.statusText}`)
let postJson
try {
  postJson = JSON.parse(postBody)
} catch {
  console.log(postBody)
  process.exit(postRes.ok ? 0 : 1)
}
console.log(JSON.stringify(postJson, null, 2))

if (!postRes.ok) {
  process.exit(1)
}

// Step 3: verify variants populated (poll up to 30s — variants are async)
const productId = postJson.id
if (!productId) {
  console.error('No product id in response')
  process.exit(1)
}
console.log(`\n=== Step 3: verify product ${productId} ===`)
let verifyJson
let attempts = 0
const maxAttempts = 10
while (attempts < maxAttempts) {
  await new Promise((r) => setTimeout(r, 3000))
  attempts++
  const verifyRes = await fetch(
    `${GELATO_API_BASE}/stores/${GELATO_STORE_ID}/products/${productId}`,
    { headers: { 'X-API-KEY': GELATO_API_KEY } }
  )
  verifyJson = await verifyRes.json()
  const variantCount = verifyJson.variants?.length ?? 0
  console.log(`  attempt ${attempts}: status=${verifyJson.status} variants=${variantCount}`)
  if (variantCount > 0) break
}
console.log(`\nFinal: status=${verifyJson.status} variants=${verifyJson.variants?.length ?? 0}`)
for (const v of verifyJson.variants ?? []) {
  console.log(`  ${v.id}: ${v.title} — productUid=${v.productUid}`)
}

// Step 4: persist gelato_product_id to artwork
console.log(`\n=== Step 4: persist to Supabase ===`)
const { error: updErr } = await supabase
  .from('artworks')
  .update({ gelato_product_id: productId, gelato_store_id: GELATO_STORE_ID })
  .eq('id', artwork.id)
if (updErr) {
  console.error('Update failed:', updErr.message)
  process.exit(1)
}
console.log(`Updated artwork ${artwork.id} with gelato_product_id=${productId}`)

console.log('\nDone.')
