/**
 * Agent base utilities.
 *
 * Each agent is a function that:
 *   1. Reads input + recent feedback for taste alignment
 *   2. Calls Anthropic Claude to produce a draft
 *   3. Drops the draft into approval_queue via `enqueueDraft`
 *
 * Agents do not publish or mutate user-facing state directly. The
 * operator decides via the inbox; downstream effects (publishing,
 * sending email, transitioning artwork status) only happen after
 * approval.
 */

import Anthropic from '@anthropic-ai/sdk'
import { recentFeedback, type ApprovalItemType, type FeedbackEventRow } from '@/lib/queue'
import { supabaseAdmin } from '@/lib/supabase/admin'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

let _client: Anthropic | null = null
export function getAnthropic(): Anthropic {
  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY missing. Required for any agent run.'
    )
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  }
  return _client
}

/**
 * The model id we default to. Sonnet is fast + cheap enough for
 * drafting tasks; Opus reserved for higher-stakes reasoning.
 */
export const DEFAULT_MODEL = 'claude-sonnet-4-6'
export const REASONING_MODEL = 'claude-opus-4-7'

/**
 * Format recent decisions for an item type as a compact few-shot
 * block to inject into an agent prompt. Keeps the operator's
 * accumulated taste in the loop.
 */
export function formatFeedbackForPrompt(
  events: FeedbackEventRow[],
  maxExamples = 10
): string {
  const slice = events.slice(0, maxExamples)
  if (slice.length === 0) {
    return 'No prior decisions yet — use your best judgment.'
  }

  const lines: string[] = ['Recent operator decisions on this item type:']
  for (const ev of slice) {
    const reason = ev.reason ? ` — Reason: ${ev.reason}` : ''
    lines.push(`- [${ev.decision.toUpperCase()}]${reason}`)
  }
  return lines.join('\n')
}

export async function loadFewShot(itemType: ApprovalItemType): Promise<string> {
  const events = await recentFeedback(itemType, 20)
  return formatFeedbackForPrompt(events)
}

/**
 * Run a Claude call with consistent error handling. Returns the
 * concatenation of all text blocks (so server-side tool use like
 * web_search, which produces interleaved tool_use / tool_result blocks
 * before the final text, still surfaces the final answer).
 */
export async function callClaude(args: {
  system: string
  user: string
  model?: string
  maxTokens?: number
  /**
   * Optional server-side tools. Pass `{ webSearch: true }` to enable
   * Anthropic's hosted web_search tool — useful when the model needs to
   * find or verify a real URL.
   */
  tools?: { webSearch?: boolean; webSearchMaxUses?: number }
}): Promise<string> {
  const client = getAnthropic()

  // The SDK types lag behind the API for hosted tools; use a structural
  // type that matches the documented shape and cast at the call site.
  const toolList: Array<Record<string, unknown>> = []
  if (args.tools?.webSearch) {
    toolList.push({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: args.tools.webSearchMaxUses ?? 3,
    })
  }

  const message = await client.messages.create({
    model: args.model ?? DEFAULT_MODEL,
    max_tokens: args.maxTokens ?? 2048,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
    ...(toolList.length > 0 ? { tools: toolList as unknown as never } : {}),
  })

  const textParts = message.content
    .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
    .map((c) => c.text)

  if (textParts.length === 0) {
    throw new Error('Anthropic returned no text content.')
  }
  return textParts.join('\n')
}

/**
 * Parse a JSON block out of Claude's response. Tolerates surrounding
 * markdown fences and prefix prose (e.g. when Claude narrates a tool
 * use before producing the final structured output).
 *
 * Strategy:
 *   1. Try a ```json fence
 *   2. Try the full string verbatim
 *   3. Scan for the last balanced [...] or {...} block
 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim()

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T
    } catch {
      // fall through
    }
  }

  try {
    return JSON.parse(trimmed) as T
  } catch {
    // fall through
  }

  const parsed = findLargestParseableJsonBlock(trimmed)
  if (parsed !== undefined) {
    return parsed as T
  }

  throw new Error(
    `Could not parse JSON from Claude output. First 300 chars: ${text.slice(0, 300)}`
  )
}

/**
 * Scan `text` for every balanced `[...]` or `{...}` region, attempt to
 * JSON.parse each, and return the value of the LARGEST one that parses.
 *
 * "Largest" matters because Claude often emits prose followed by the
 * intended JSON, e.g. `Sure, here you go: [ { "id": "..." } ]`. The
 * outer array and the inner object are both balanced — but the older
 * "last balanced block" heuristic picked the inner object (latest
 * starting position), which then failed our `Array.isArray` check.
 * Picking the largest parseable block returns the outer array as
 * intended, and naturally ignores stray `[]` / `{}` literals that
 * appear in tool_result blocks or prose.
 */
function findLargestParseableJsonBlock(text: string): unknown {
  let best: { value: unknown; len: number } | null = null
  for (let start = 0; start < text.length; start++) {
    const ch = text[start]
    if (ch !== '[' && ch !== '{') continue
    const open = ch
    const close = ch === '[' ? ']' : '}'
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (c === open) depth++
      else if (c === close) {
        depth--
        if (depth === 0) {
          const candidate = text.slice(start, i + 1)
          try {
            const value = JSON.parse(candidate)
            if (!best || candidate.length > best.len) {
              best = { value, len: candidate.length }
            }
          } catch {
            // not parseable as JSON — skip this candidate
          }
          break
        }
      }
    }
  }
  return best?.value
}

/**
 * Idempotency helper: starts an agent_tasks row with a trigger_key.
 * If a row already exists for (agent_name, trigger_key) in a non-terminal
 * state, returns null to signal "already running or done — skip".
 *
 * `correlationId` (optional) groups multiple tasks triggered by one
 * operator action — e.g. `artwork:<uuid>` so the post-Gelato chain
 * (auto-publisher, mockup-publisher, listing-sync) all share one ID
 * and the artwork edit page can show them as a single "pipeline
 * activity" timeline.
 */
export async function startAgentTask(args: {
  agentName: string
  triggerKind: 'event' | 'cron' | 'manual'
  triggerKey?: string | null
  correlationId?: string | null
  input?: Record<string, unknown>
}): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .insert({
      agent_name: args.agentName,
      trigger_kind: args.triggerKind,
      trigger_key: args.triggerKey ?? null,
      correlation_id: args.correlationId ?? null,
      input: args.input ?? {},
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    // Unique violation = already exists; skip
    if (error.code === '23505') return null
    throw new Error(`startAgentTask failed: ${error.message}`)
  }

  return data as { id: string }
}

export async function finishAgentTask(
  id: string,
  args: { status: 'succeeded' | 'failed' | 'cancelled'; output?: Record<string, unknown>; error?: string }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('agent_tasks')
    .update({
      status: args.status,
      output: args.output ?? null,
      error_message: args.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    console.error(`finishAgentTask failed (non-fatal): ${error.message}`)
  }
}
