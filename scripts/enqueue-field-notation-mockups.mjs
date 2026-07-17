/**
 * Enqueue mockup-compose tasks for Emil Varga's 12 Field Notation drafts.
 *
 * Mirrors enqueueMockupCompose (lib/mockup-compose-worker.ts): inserts one
 * queued `agent_tasks` row per artwork (agent 'mockup-composer'), de-duped on
 * the artwork correlation id. The deployed `mockup_worker` cron (every minute)
 * claims and composes each set (~100s of Gemini calls) and persists it to
 * artworks.mockup_urls. This script does not run any Gemini calls itself.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/enqueue-field-notation-mockups.mjs           # queue missing
 *   node scripts/enqueue-field-notation-mockups.mjs --force   # regenerate all
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ADMIN_ROOT = path.resolve(__dirname, '..')

const envText = await fs.readFile(path.join(ADMIN_ROOT, '.env'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const FORCE = process.argv.includes('--force')
const ARTIST_ID = '00000000-0000-0000-0000-000000000a10' // Emil Varga
const AGENT = 'mockup-composer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const { data: arts, error } = await supabase
  .from('artworks')
  .select('id, title, image_url, product_type, mockup_urls')
  .eq('artist_id', ARTIST_ID)
  .order('title')
if (error) {
  console.error('Fetch failed:', error.message)
  process.exit(1)
}
console.log(`Emil Varga artworks: ${arts.length}${FORCE ? ' (force regenerate)' : ''}\n`)

let queued = 0
let deduped = 0
let skipped = 0
for (const a of arts) {
  if (!a.image_url || !a.product_type) {
    skipped++
    console.log(`  skip  ${a.title}  (missing ${!a.image_url ? 'image_url' : 'product_type'})`)
    continue
  }

  const correlationId = `artwork:${a.id}`

  // De-dupe on the active task, same as enqueueMockupCompose.
  const { data: active } = await supabase
    .from('agent_tasks')
    .select('id, status')
    .eq('agent_name', AGENT)
    .eq('correlation_id', correlationId)
    .in('status', ['queued', 'running'])
    .limit(1)
  if (active && active.length) {
    deduped++
    console.log(`  dupe  ${a.title}  (already ${active[0].status})`)
    continue
  }

  const { data: ins, error: insErr } = await supabase
    .from('agent_tasks')
    .insert({
      agent_name: AGENT,
      trigger_kind: 'manual',
      trigger_key: null,
      correlation_id: correlationId,
      input: { artwork_id: a.id, force: FORCE, aesthetic_hint: null },
      status: 'queued',
    })
    .select('id')
    .single()
  if (insErr) {
    if (insErr.code === '23505') {
      deduped++
      continue
    }
    console.error(`  enqueue failed for ${a.title}: ${insErr.message}`)
    process.exit(1)
  }
  queued++
  console.log(`  queued  ${a.title}  task ${ins.id}`)
}

console.log(`\n${queued} queued, ${deduped} already active, ${skipped} skipped.`)
console.log(
  'The mockup_worker cron (every minute) will compose these; each set is ~100s of Gemini calls.'
)
