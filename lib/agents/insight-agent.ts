/**
 * Insight agent.
 *
 * Cron: weekly. Pulls performance data from approval_queue +
 * feedback_events + agent_tasks + (when wired) Shopify orders +
 * Meta Ads, and produces a weekly insight card with recommended
 * next actions.
 *
 * Until live sales/ads data flows in, the agent runs in "internal
 * activity" mode — summarizing operator decision patterns and
 * agent run health.
 */

import { callClaude, startAgentTask, finishAgentTask, REASONING_MODEL } from './base'
import { enqueueDraft } from '@/lib/queue'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface InsightCard {
  period_start: string
  period_end: string
  headline: string
  summary_md: string
  recommended_actions: Array<{
    action: string
    rationale: string
    suggested_owner: 'operator' | 'agent'
  }>
  metric_snapshot: {
    pending_queue_items: number
    decisions_in_period: number
    approval_rate: number
    rejection_reasons: Array<{ theme: string; count: number }>
    most_active_agent: string | null
    failed_agent_runs: number
  }
}

const SYSTEM_PROMPT = `You are ArtInScale's weekly performance analyst.

Given the past week of operator decisions and agent activity, produce a single insight card. Focus on:
  - Patterns in what was approved vs. rejected
  - Recurring rejection themes (taste signals)
  - Agent reliability (failures, throughput)
  - Actionable next steps for the operator OR for an agent to take next week

Output JSON of the exact shape provided in the user prompt template — do NOT add or remove fields.`

export async function runInsightAgent(args?: {
  triggerKind?: 'cron' | 'manual'
}): Promise<{ approvalQueueId: string } | { skipped: 'already_running' }> {
  const now = new Date()
  const periodEnd = now.toISOString()
  const periodStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()

  const triggerKey = `weekly-${now.toISOString().slice(0, 10)}`

  const task = await startAgentTask({
    agentName: 'insight_agent',
    triggerKind: args?.triggerKind ?? 'cron',
    triggerKey,
    input: { periodStart, periodEnd },
  })

  if (!task) return { skipped: 'already_running' }

  try {
    const { data: feedback } = await supabaseAdmin
      .from('feedback_events')
      .select('item_type, decision, reason, source_agent, created_at')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)
      .order('created_at', { ascending: false })
      .limit(500)

    const { data: pending } = await supabaseAdmin
      .from('approval_queue')
      .select('item_type')
      .eq('status', 'pending')

    const { data: failedRuns } = await supabaseAdmin
      .from('agent_tasks')
      .select('agent_name, error_message, created_at')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)
      .eq('status', 'failed')

    const decisions = (feedback ?? []) as Array<{
      item_type: string
      decision: string
      reason: string | null
      source_agent: string | null
    }>

    const approvalCount = decisions.filter((d) =>
      ['approved', 'edited', 'auto_approved'].includes(d.decision)
    ).length
    const totalDecisions = decisions.length
    const approvalRate = totalDecisions > 0 ? approvalCount / totalDecisions : 0

    // Per-agent decision counts
    const perAgent = new Map<string, number>()
    for (const d of decisions) {
      if (!d.source_agent) continue
      perAgent.set(d.source_agent, (perAgent.get(d.source_agent) ?? 0) + 1)
    }
    const mostActiveAgent =
      [...perAgent.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    const userPrompt = [
      `Period: ${periodStart} → ${periodEnd}`,
      '',
      `Pending queue items now: ${pending?.length ?? 0}`,
      `Decisions in period: ${totalDecisions}`,
      `Approval rate: ${(approvalRate * 100).toFixed(1)}%`,
      `Most active agent: ${mostActiveAgent ?? 'n/a'}`,
      `Failed agent runs: ${failedRuns?.length ?? 0}`,
      '',
      'Rejection reasons (top 30):',
      decisions
        .filter((d) => d.decision === 'rejected' && d.reason)
        .slice(0, 30)
        .map((d) => `  - [${d.item_type}] ${d.reason}`)
        .join('\n') || '  (none)',
      '',
      'Failed agent run errors (top 10):',
      (failedRuns ?? [])
        .slice(0, 10)
        .map((f) => {
          const r = f as { agent_name: string; error_message: string }
          return `  - ${r.agent_name}: ${r.error_message?.slice(0, 200)}`
        })
        .join('\n') || '  (none)',
      '',
      'Produce the insight card now in this exact JSON shape:',
      JSON.stringify(
        {
          period_start: periodStart,
          period_end: periodEnd,
          headline: '...',
          summary_md: '...',
          recommended_actions: [
            { action: '...', rationale: '...', suggested_owner: 'operator' },
          ],
          metric_snapshot: {
            pending_queue_items: pending?.length ?? 0,
            decisions_in_period: totalDecisions,
            approval_rate: Number(approvalRate.toFixed(3)),
            rejection_reasons: [{ theme: '...', count: 0 }],
            most_active_agent: mostActiveAgent,
            failed_agent_runs: failedRuns?.length ?? 0,
          },
        },
        null,
        2
      ),
    ].join('\n')

    const text = await callClaude({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      model: REASONING_MODEL,
      maxTokens: 2500,
    })

    let card: InsightCard
    try {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
      card = JSON.parse((fenced ? fenced[1] : text).trim()) as InsightCard
    } catch (err) {
      throw new Error(`Could not parse insight JSON: ${text.slice(0, 200)}`)
    }

    const queued = await enqueueDraft({
      itemType: 'insight',
      payload: card as unknown as Record<string, unknown>,
      sourceAgent: 'insight_agent',
      context: { periodStart, periodEnd },
    })

    await finishAgentTask(task.id, {
      status: 'succeeded',
      output: { approvalQueueId: queued.id, totalDecisions, approvalRate },
    })

    return { approvalQueueId: queued.id }
  } catch (err) {
    await finishAgentTask(task.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
