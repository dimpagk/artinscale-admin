/**
 * Phase 0 audit snapshot — runs read-only queries against Supabase to
 * capture the current state of the data model. Idempotent, safe to run
 * any time. Output is machine-readable JSON, suitable for pasting into
 * docs/PHASE_0_AUDIT.md or just for an at-a-glance status check.
 *
 * Usage:
 *   cd artinscale-admin
 *   node scripts/phase-0-snapshot.mjs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function count(table, filters = {}) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true })
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
  const { count: c, error } = await q
  if (error) return { error: error.message }
  return c ?? 0
}

async function head(table, columns, limit = 5, order = null) {
  let q = supabase.from(table).select(columns).limit(limit)
  if (order) q = q.order(order, { ascending: false })
  const { data, error } = await q
  if (error) return { error: error.message }
  return data
}

const snapshot = {
  generated_at: new Date().toISOString(),
  supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
}

// ============================================
// Core content tables
// ============================================
snapshot.topics = {
  total: await count('topics'),
  active: await count('topics', { status: 'active' }),
  upcoming: await count('topics', { status: 'upcoming' }),
  completed: await count('topics', { status: 'completed' }),
  list: await head('topics', 'id, title, status, target_contributors, deadline', 20),
}

snapshot.topic_contributions = {
  total: await count('topic_contributions'),
  pending: await count('topic_contributions', { status: 'pending' }),
  approved: await count('topic_contributions', { status: 'approved' }),
  rejected: await count('topic_contributions', { status: 'rejected' }),
  community: await count('topic_contributions', { source: 'community' }),
  studio_seed: await count('topic_contributions', { source: 'studio_seed' }),
}

snapshot.users = {
  total: await count('users'),
  by_role: {
    admin: await count('users', { role: 'ADMIN' }),
    artist: await count('users', { role: 'ARTIST' }),
    contributor: await count('users', { role: 'CONTRIBUTOR' }),
  },
  artists: await head('users', 'id, name, role', 10),
}

snapshot.artworks = {
  total: await count('artworks'),
  created: await count('artworks', { status: 'created' }),
  listed: await count('artworks', { status: 'listed' }),
  sold: await count('artworks', { status: 'sold' }),
  recent: await head('artworks', 'id, title, status, topic_id, shopify_handle, gelato_product_id, created_at', 10, 'created_at'),
}

snapshot.generated_images = {
  total: await count('generated_images'),
  with_artwork: 0, // computed below
}
{
  const { count: c } = await supabase
    .from('generated_images')
    .select('id', { count: 'exact', head: true })
    .not('artwork_id', 'is', null)
  snapshot.generated_images.with_artwork = c ?? 0
}

snapshot.social_posts = {
  total: await count('social_posts'),
  draft: await count('social_posts', { status: 'draft' }),
  scheduled: await count('social_posts', { status: 'scheduled' }),
  published: await count('social_posts', { status: 'published' }),
}

snapshot.product_topics = {
  total: await count('product_topics'),
  list: await head('product_topics', 'shopify_handle, topic_id', 20),
}

// ============================================
// Agent + queue infrastructure
// ============================================
snapshot.approval_queue = {
  total: await count('approval_queue'),
  pending: await count('approval_queue', { status: 'pending' }),
  approved: await count('approval_queue', { status: 'approved' }),
  edited: await count('approval_queue', { status: 'edited' }),
  rejected: await count('approval_queue', { status: 'rejected' }),
}

snapshot.feedback_events = {
  total: await count('feedback_events'),
}

snapshot.agent_tasks = {
  total: await count('agent_tasks'),
  running: await count('agent_tasks', { status: 'running' }),
  succeeded: await count('agent_tasks', { status: 'succeeded' }),
  failed: await count('agent_tasks', { status: 'failed' }),
}

// ============================================
// Schema reconciliation check (PHASE_0_AUDIT §3.4)
// ============================================
{
  const { data, error } = await supabase
    .rpc('exec_sql', { sql: 'select 1' })
    .single()
  // exec_sql probably doesn't exist; fall back to a simple query that
  // works with PostgREST: ask information_schema via a view if we made
  // one. We don't, so just probe by trying both join shapes.
  void data
  void error
}
{
  // Probe: does artworks.topic_id accept a VARCHAR(100) topic id?
  // We won't write — we just check shape via a select join with a
  // string id and see if it succeeds.
  const { error } = await supabase
    .from('artworks')
    .select('id, topic_id, topics!inner(id)')
    .limit(1)
  snapshot.schema_check = {
    artworks_topics_join_works: !error,
    error: error?.message ?? null,
  }
}

console.log(JSON.stringify(snapshot, null, 2))
