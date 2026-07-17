/**
 * Recover artworks whose Gelato product got stuck with zero variants (the
 * variant-creation worker never ran, so Gelato never publishes and the
 * finalize_listings cron waits forever).
 *
 * For each of Emil Varga's artworks that has a gelato_product_id whose live
 * Gelato product has variants: [] and status 'created':
 *   1. DELETE the broken (empty, unpublished) Gelato product.
 *   2. Clear gelato_product_id / gelato_store_id on the artwork row.
 *   3. Recreate via :create-from-template (same contract as lib/gelato.ts).
 *   4. Persist the new ids and poll ~90s, watching variants populate.
 *
 * Guarded: only deletes products with zero variants, so a healthy product is
 * never touched. Once variants populate, the finalize_listings cron completes
 * the Shopify listing on its next run.
 *
 * Usage:  cd artinscale-admin && node scripts/recover-stuck-gelato-push.mjs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envText = await fs.readFile(path.join(__dirname, '..', '.env'), 'utf8')
for (const l of envText.split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }

const BASE = 'https://ecommerce.gelatoapis.com/v1'
const KEY = process.env.GELATO_API_KEY
const STORE = process.env.GELATO_STORE_ID
const ARTIST = '00000000-0000-0000-0000-000000000a10'
// museum-poster-40x50 template (lib/gelato-templates.ts).
const TEMPLATE_BY_SIZE = { 'museum-poster-40x50': 'fe4c42d0-3a9b-4a02-8483-5fde5beeed4e' }

const gelato = (p, init = {}) =>
  fetch(`${BASE}${p}`, { ...init, headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } })

if (!KEY || !STORE) { console.error('Missing GELATO_API_KEY / GELATO_STORE_ID'); process.exit(1) }
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: arts } = await s
  .from('artworks')
  .select('id, title, description, image_url, product_type, gelato_product_id')
  .eq('artist_id', ARTIST)
  .not('gelato_product_id', 'is', null)

for (const a of arts) {
  console.log(`\n== ${a.title} ==`)
  const cur = await gelato(`/stores/${STORE}/products/${a.gelato_product_id}`)
  if (!cur.ok) { console.log(`  Gelato GET ${cur.status}; skipping`); continue }
  const prod = await cur.json()
  const nVar = Array.isArray(prod.variants) ? prod.variants.length : 0
  if (nVar > 0) { console.log(`  healthy (${nVar} variants) — leaving it`); continue }
  console.log(`  stuck: status=${prod.status}, variants=0 — recovering`)

  // 1. Delete the broken product.
  const del = await gelato(`/stores/${STORE}/products/${a.gelato_product_id}`, { method: 'DELETE' })
  console.log(`  delete old ${a.gelato_product_id}: HTTP ${del.status}`)

  // 2. Clear ids.
  await s.from('artworks').update({ gelato_product_id: null, gelato_store_id: null }).eq('id', a.id)

  // 3. Recreate via :create-from-template.
  const templateUid = TEMPLATE_BY_SIZE[a.product_type]
  if (!templateUid) { console.log(`  no template for ${a.product_type}; skipping recreate`); continue }
  const tRes = await gelato(`/templates/${templateUid}`)
  const tmpl = await tRes.json()
  const variants = (tmpl.variants || []).map((v) => ({
    templateVariantId: v.id,
    imagePlaceholders: (v.imagePlaceholders || []).map((ph) => ({ name: ph.name, fileUrl: a.image_url, fitMethod: 'slice' })),
  }))
  const metadata = [
    { key: 'publishImmediately', value: 'true' },
    { key: 'publishWithFreeShipping', value: 'false' },
    { key: 'previewFileType', value: 'webp' },
    { key: 'usedStandardMockup', value: '1' },
    { key: 'publishScopes', value: '["product"]' },
    { key: 'publishMode', value: 'bulk_edit' },
  ]
  const create = await gelato(`/stores/${STORE}/products:create-from-template`, {
    method: 'POST',
    body: JSON.stringify({
      templateId: templateUid,
      title: a.title,
      description: `<p>${a.description || a.title}</p>`,
      isVisibleInTheOnlineStore: true,
      salesChannels: ['web'],
      tags: ['illustration', 'museum-matte', 'archival-print', 'size-40x50'],
      metadata,
      variants,
    }),
  })
  if (!create.ok) { console.log(`  recreate FAILED HTTP ${create.status}: ${(await create.text()).slice(0, 300)}`); continue }
  const fresh = await create.json()
  console.log(`  recreated: ${fresh.id} (status ${fresh.status}, variants ${Array.isArray(fresh.variants) ? fresh.variants.length : 0})`)

  // 4. Persist + poll for variants.
  await s.from('artworks').update({ gelato_product_id: fresh.id, gelato_store_id: STORE }).eq('id', a.id)
  const deadline = Date.now() + 95000
  let done = false
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000))
    const chk = await gelato(`/stores/${STORE}/products/${fresh.id}`)
    if (!chk.ok) continue
    const b = await chk.json()
    const v = Array.isArray(b.variants) ? b.variants.length : 0
    console.log(`  poll: status=${b.status} variants=${v} handle=${b.handle || '-'} ready=${b.isReadyToPublish}`)
    if (v > 0) { console.log(`  ✓ variants populated (${v}) — finalize cron will complete Shopify`); done = true; break }
  }
  if (!done) console.log('  ✗ still 0 variants after 90s — suspect the print file (size/format)')
}
console.log('\nRecovery pass complete.')
