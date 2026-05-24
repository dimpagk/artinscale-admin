/**
 * One-shot cleanup: delete the 28 test studio_seed contributions that
 * were created during queue verification on the "breath" topic.
 *
 * Strategy: sort all pending studio_seed contributions for the topic by
 * `updated_at` DESC and delete the most recent N. The original 32 were
 * refined together (close `updated_at` cluster); the test rows were
 * inserted AFTER that so they sit on top of the sort.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/cleanup-test-seeds.mjs
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

const TOPIC_ID = 'breath'
const DELETE_COUNT = 28

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const { data: rows, error } = await supabase
  .from('topic_contributions')
  .select('id, contributor_name, type, created_at, updated_at')
  .eq('topic_id', TOPIC_ID)
  .eq('status', 'pending')
  .eq('source', 'studio_seed')
  .order('updated_at', { ascending: false })
  .limit(DELETE_COUNT)

if (error) {
  console.error('Fetch failed:', error.message)
  process.exit(1)
}

if (!rows || rows.length === 0) {
  console.log('Nothing to delete.')
  process.exit(0)
}

console.log(`Found ${rows.length} most-recent pending studio_seed contributions for "${TOPIC_ID}":`)
for (const r of rows) {
  console.log(`  ${r.contributor_name} (${r.type}) — created ${r.created_at.slice(0, 10)}, updated ${r.updated_at.slice(0, 19)}`)
}

const ids = rows.map((r) => r.id)
const { error: deleteError, count } = await supabase
  .from('topic_contributions')
  .delete({ count: 'exact' })
  .in('id', ids)

if (deleteError) {
  console.error('Delete failed:', deleteError.message)
  process.exit(1)
}

console.log(`\nDeleted ${count ?? rows.length} contributions.`)
