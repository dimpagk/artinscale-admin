/**
 * Seed the hero-piece ad copy for the marketing test into ad_creatives.
 *
 * Requires migration 046 applied. Looks each piece up by its Shopify
 * handle, then upserts one row per (artwork_id, format, campaign) so
 * re-running corrects the copy in place instead of duplicating.
 *
 * Copy is drafted to the premium standard: refined, gallery voice, no
 * hype, no clichés, no em-dashes. Edit freely in the admin /marketing
 * review page after seeding; this script is just the starting draft.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/seed-ad-creatives.mjs                # upsert all formats
 *   node scripts/seed-ad-creatives.mjs --only video   # upsert one format only
 *
 * The --only filter lets you add a new format (e.g. video) without
 * re-upserting the in_room/flat rows, so operator edits to those survive.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from .env).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Minimal .env loader (same approach as generate-mockup-scenes.mjs).
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const CAMPAIGN = 'test-2026-07'

// One entry per creative variant. `handle` resolves to artwork_id.
// `aiDisclosure` true for studio/AI pieces (Meta disclosure must be ticked).
const CREATIVES = [
  {
    handle: 'portrait-of-the-priestess',
    format: 'in_room',
    aiDisclosure: true,
    headline: 'Presence, framed',
    primary_text:
      'Portrait of the Priestess, printed on museum-quality matte paper at 50x70 cm and made to order for your wall. Composed in our studio, curated by hand.',
  },
  {
    handle: 'portrait-of-the-priestess',
    format: 'flat',
    aiDisclosure: true,
    headline: 'A portrait with weight',
    primary_text:
      'Deep pigment on heavyweight matte paper. Portrait of the Priestess, 50x70 cm, printed to order and shipped ready to frame.',
  },
  {
    handle: 'coral-hour-hardanger',
    format: 'in_room',
    aiDisclosure: true,
    headline: 'The light before dusk',
    primary_text:
      'Coral Hour, Hardanger holds a warm, low sun in the room. Museum-quality matte print at 50x70 cm, made to order. Composed in our studio.',
  },
  {
    handle: 'coral-hour-hardanger',
    format: 'flat',
    aiDisclosure: true,
    headline: 'Warmth you can hang',
    primary_text:
      'A coral horizon over still water, printed on heavyweight matte paper at 50x70 cm and shipped ready to frame.',
  },
  {
    handle: 'still-water-olive-leaf',
    format: 'in_room',
    aiDisclosure: true,
    headline: 'Calm, in one frame',
    primary_text:
      'Still Water, Olive Leaf is a quiet Mediterranean note for a considered room. Museum-quality matte print, 50x70 cm, made to order.',
  },
  {
    handle: 'still-water-olive-leaf',
    format: 'flat',
    aiDisclosure: true,
    headline: 'A quieter kind of blue',
    primary_text:
      'Soft olive and water on heavyweight matte paper. 50x70 cm, printed to order and shipped ready to frame.',
  },
  {
    handle: 'held-breath',
    format: 'in_room',
    aiDisclosure: false,
    headline: 'A figure, held still',
    primary_text:
      'Held Breath, an original figure study in cobalt and gold. Museum-quality matte print at 50x70 cm, made to order and shipped ready to frame.',
    notes:
      'In-room format only. The flat close-up reads as semi-nude and risks Meta adult-nudity rejection; advertise this piece with the room shot only.',
  },

  // Video-format copy for the top pieces (the 3 AI heroes), for a 5-10s
  // slow pan/zoom over the artwork. Held Breath is excluded: a panning
  // shot of a semi-nude figure study carries the same Meta review risk as
  // its flat close-up.
  {
    handle: 'portrait-of-the-priestess',
    format: 'video',
    aiDisclosure: true,
    headline: 'Watch the light settle',
    primary_text:
      'A slow pass over Portrait of the Priestess. Museum-quality matte print at 50x70 cm, made to order. Composed in our studio, curated by hand.',
  },
  {
    handle: 'coral-hour-hardanger',
    format: 'video',
    aiDisclosure: true,
    headline: 'A held coral hour',
    primary_text:
      'The low sun of Coral Hour, Hardanger, lingered over for a moment. Museum-quality matte print at 50x70 cm, made to order. Composed in our studio.',
  },
  {
    handle: 'still-water-olive-leaf',
    format: 'video',
    aiDisclosure: true,
    headline: 'Stillness, slowly',
    primary_text:
      'A quiet pass across Still Water, Olive Leaf. Museum-quality matte print at 50x70 cm, made to order. Composed in our studio.',
  },
]

async function main() {
  const onlyIdx = process.argv.indexOf('--only')
  const onlyFormat = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null
  const targets = onlyFormat
    ? CREATIVES.filter((c) => c.format === onlyFormat)
    : CREATIVES
  if (onlyFormat) console.log(`Filtering to format "${onlyFormat}": ${targets.length} rows\n`)

  let ok = 0
  for (const c of targets) {
    const { data: art, error: artErr } = await supabase
      .from('artworks')
      .select('id, title')
      .eq('shopify_handle', c.handle)
      .single()
    if (artErr || !art) {
      console.error(`SKIP ${c.handle}/${c.format}: artwork not found (${artErr?.message ?? 'no row'})`)
      continue
    }
    const { error: upErr } = await supabase
      .from('ad_creatives')
      .upsert(
        {
          artwork_id: art.id,
          campaign: CAMPAIGN,
          format: c.format,
          headline: c.headline,
          primary_text: c.primary_text,
          ai_disclosure: c.aiDisclosure,
          notes: c.notes ?? null,
          status: 'draft',
        },
        { onConflict: 'artwork_id,format,campaign' }
      )
    if (upErr) {
      console.error(`FAIL ${art.title}/${c.format}: ${upErr.message}`)
      continue
    }
    ok++
    console.log(`OK   ${art.title} [${c.format}]`)
  }
  console.log(`\nSeeded ${ok}/${targets.length} creatives into campaign ${CAMPAIGN}.`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
