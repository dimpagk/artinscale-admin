/**
 * Gelato variant-creation canary.
 *
 * Background: since ~2026-07-03, Gelato's background variant/mockup worker
 * stopped materializing variants for the Artinscale store — both
 * :create-from-template and the bare /products endpoint return 200 but the
 * product stays `status: created` with `variants: []` forever, so nothing
 * publishes to Shopify. Confirmed store-specific (product + connection are
 * healthy, no global Gelato outage). See docs/gelato-support-ticket.md.
 *
 * This canary creates ONE throwaway product, waits for variants, deletes it,
 * and reports whether Gelato has recovered:
 *   exit 0  -> variants populated: Gelato is working again, safe to re-push
 *   exit 1  -> still 0 variants: Gelato still broken
 *   exit 2  -> could not run the check (creds/API error)
 *
 * The throwaway product is hidden (isVisibleInTheOnlineStore:false), tagged
 * 'canary', and always deleted, so it never reaches the storefront.
 *
 * Usage:  cd artinscale-admin && node scripts/gelato-variant-canary.mjs
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
const TEMPLATE = 'fe4c42d0-3a9b-4a02-8483-5fde5beeed4e' // museum-poster-40x50

if (!KEY || !STORE) { console.error('CANARY: missing GELATO creds'); process.exit(2) }

// Use a real, hosted print master as the placeholder image (image host is
// irrelevant to the variant check — both Supabase and Shopify CDN were
// verified to fail equally while Gelato is broken).
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: seedArt } = await supabase.from('artworks').select('image_url').eq('artist_id', '00000000-0000-0000-0000-000000000a10').not('image_url', 'is', null).limit(1).single()
const IMG = seedArt?.image_url
if (!IMG) { console.error('CANARY: no seed image_url available'); process.exit(2) }
const gel = (p, init = {}) => fetch(`${BASE}${p}`, { ...init, headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } })

let productId = null
try {
  const tmpl = await (await gel(`/templates/${TEMPLATE}`)).json()
  const variants = tmpl.variants.map((v) => ({
    templateVariantId: v.id,
    imagePlaceholders: v.imagePlaceholders.map((ph) => ({ name: ph.name, fileUrl: IMG, fitMethod: 'slice' })),
  }))
  const res = await gel(`/stores/${STORE}/products:create-from-template`, {
    method: 'POST',
    body: JSON.stringify({
      templateId: TEMPLATE,
      title: 'CANARY — delete me',
      description: '<p>gelato variant canary</p>',
      isVisibleInTheOnlineStore: false,
      salesChannels: [],
      tags: ['canary'],
      metadata: [],
      variants,
    }),
  })
  if (!res.ok) { console.error(`CANARY: create failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(2) }
  const prod = await res.json()
  productId = prod.id

  let variantCount = 0
  for (let i = 0; i < 15; i++) { // ~90s
    await new Promise((r) => setTimeout(r, 6000))
    const b = await (await gel(`/stores/${STORE}/products/${productId}`)).json()
    variantCount = Array.isArray(b.variants) ? b.variants.length : 0
    if (variantCount > 0) break
  }

  if (variantCount > 0) {
    console.log(`CANARY: RECOVERED — variants populated (${variantCount}). Gelato is working again; safe to re-push.`)
    process.exitCode = 0
  } else {
    console.log('CANARY: still broken — 0 variants after 90s. Gelato variant worker still down.')
    process.exitCode = 1
  }
} catch (err) {
  console.error('CANARY: error', err instanceof Error ? err.message : String(err))
  process.exitCode = 2
} finally {
  if (productId) { try { await gel(`/stores/${STORE}/products/${productId}`, { method: 'DELETE' }) } catch { /* best effort */ } }
}
