'use server'

import { revalidatePath } from 'next/cache'
import { decideItem, getQueueItem, type ApprovalStatus } from '@/lib/queue'
import { executeApprovedItem, type ExecutorResult } from '@/lib/executors'

export interface DecisionOutcome {
  decided: true
  execution?: ExecutorResult
  executionError?: string
}

/**
 * Decide on a queue item — approve / reject / edit. When the decision is
 * approved/edited/auto_approved, the matching executor is invoked to
 * materialize the downstream effect (create social_posts, send the
 * email, post the comment reply, etc.).
 *
 * Execution failures do NOT roll back the decision. The decision is the
 * source of truth; failed executions surface in the UI and the operator
 * can retry via `retryExecutionAction`.
 */
export async function decideQueueItemAction(
  id: string,
  decision: 'approved' | 'rejected' | 'edited' | 'auto_approved',
  formData: FormData
): Promise<DecisionOutcome> {
  const reason = (formData.get('reason') as string | null)?.trim() || undefined
  const editsRaw = (formData.get('edits_json') as string | null)?.trim()
  let editsDiff: Record<string, unknown> | undefined
  if (editsRaw) {
    try {
      editsDiff = JSON.parse(editsRaw) as Record<string, unknown>
    } catch {
      throw new Error('edits_json must be valid JSON if provided')
    }
  }

  await decideItem(id, { decision, reason, editsDiff })

  let execution: ExecutorResult | undefined
  let executionError: string | undefined

  if (decision === 'approved' || decision === 'edited' || decision === 'auto_approved') {
    const item = await getQueueItem(id)
    if (item) {
      try {
        execution = await executeApprovedItem(item)
      } catch (err) {
        executionError = err instanceof Error ? err.message : String(err)
        console.error(`[queue executor] item ${id} failed:`, err)
      }
    }
  }

  revalidatePath('/queue')
  return { decided: true, execution, executionError }
}

/**
 * Retry the executor for an already-approved item. Useful when
 * downstream services (Meta, Resend, Supabase) had a transient failure
 * the first time.
 */
export async function retryExecutionAction(id: string): Promise<DecisionOutcome> {
  const item = await getQueueItem(id)
  if (!item) throw new Error(`Queue item ${id} not found`)
  if (
    item.status !== 'approved' &&
    item.status !== 'edited' &&
    item.status !== 'auto_approved'
  ) {
    throw new Error(`Item is in status=${item.status} — only approved items can be re-executed`)
  }

  let execution: ExecutorResult | undefined
  let executionError: string | undefined
  try {
    execution = await executeApprovedItem(item)
  } catch (err) {
    executionError = err instanceof Error ? err.message : String(err)
  }
  revalidatePath('/queue')
  return { decided: true, execution, executionError }
}

export async function approveAction(id: string, formData: FormData): Promise<DecisionOutcome> {
  return decideQueueItemAction(id, 'approved', formData)
}

export async function rejectAction(id: string, formData: FormData): Promise<DecisionOutcome> {
  return decideQueueItemAction(id, 'rejected', formData)
}

/**
 * Type-coercing wrapper used by client components that build the
 * decision dynamically.
 */
export async function decideAction(
  id: string,
  decision: ApprovalStatus,
  formData: FormData
): Promise<DecisionOutcome> {
  if (decision === 'pending' || decision === 'expired') {
    throw new Error(`decideAction does not accept "${decision}" — pick approved/rejected/edited.`)
  }
  return decideQueueItemAction(id, decision, formData)
}
