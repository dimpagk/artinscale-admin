/**
 * Find Zara Oduya's link contribution, refine it with web_search-enabled
 * "broken URL" feedback, and report before/after URLs.
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

// Find Zara's link contribution
const { data: zara, error: zErr } = await supabase
  .from('topic_contributions')
  .select('id, content, caption')
  .eq('topic_id', 'breath')
  .eq('type', 'link')
  .ilike('contributor_name', '%Zara%')
  .single()

if (zErr || !zara) {
  console.error('Not found:', zErr?.message)
  process.exit(1)
}

console.log('BEFORE:')
console.log('  URL:    ', zara.content)
console.log('  Caption:', zara.caption?.slice(0, 100))

// Hit the dev server
const port = process.env.PORT || '3001'
const res = await fetch(`http://localhost:${port}/api/topics/breath/refine-contributions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    instructions: 'this link is broken — find a real working URL of Sara Lazar TED talk on meditation',
    ids: [zara.id],
  }),
})

const queued = await res.json()
console.log('\nQueued:', queued)

if (!queued.task_id) {
  process.exit(1)
}

// Poll for completion
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  const { data: task } = await supabase
    .from('agent_tasks')
    .select('status, output, error_message')
    .eq('id', queued.task_id)
    .single()
  if (task?.status === 'succeeded' || task?.status === 'failed') {
    console.log('\nTask:', task.status, task.output ?? task.error_message)
    break
  }
}

const { data: after } = await supabase
  .from('topic_contributions')
  .select('content, caption')
  .eq('id', zara.id)
  .single()

console.log('\nAFTER:')
console.log('  URL:    ', after?.content)
console.log('  Caption:', after?.caption?.slice(0, 100))
console.log(
  '\nURL changed:',
  zara.content === after?.content ? 'NO (Claude kept the same URL)' : 'YES'
)
