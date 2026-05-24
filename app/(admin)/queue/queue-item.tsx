'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { decideAction, retryExecutionAction } from './actions'
import { RelativeTime, QueuePreview } from '@/components/admin-ui'
import type { ApprovalQueueRow } from '@/lib/queue'

const TYPE_LABELS: Record<string, string> = {
  topic: 'Topic',
  contribution: 'Contribution batch',
  artwork: 'Artwork',
  social_campaign: 'Drop campaign',
  social_post: 'Social post',
  email: 'Email',
  comment_reply: 'Comment reply',
  insight: 'Insight',
}

interface QueueItemProps {
  item: ApprovalQueueRow
}

export function QueueItem({ item }: QueueItemProps) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | 'retry' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canRetry, setCanRetry] = useState(false)

  const decide = async (decision: 'approved' | 'rejected') => {
    setError(null)
    setCanRetry(false)
    setSubmitting(decision === 'approved' ? 'approve' : 'reject')
    try {
      const fd = new FormData()
      if (reason.trim()) fd.append('reason', reason.trim())
      const outcome = await decideAction(item.id, decision, fd)
      if (decision === 'approved' && outcome.executionError) {
        setError(`Decided, but execution failed: ${outcome.executionError}`)
        setCanRetry(true)
        setSubmitting(null)
      } else {
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decide')
      setSubmitting(null)
    }
  }

  const retryExecution = async () => {
    setSubmitting('retry')
    setError(null)
    try {
      const outcome = await retryExecutionAction(item.id)
      if (outcome.executionError) {
        setError(`Execution still failed: ${outcome.executionError}`)
        setCanRetry(true)
      } else {
        setCanRetry(false)
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry execution')
      setCanRetry(true)
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="warning" size="sm">
                {TYPE_LABELS[item.item_type] ?? item.item_type}
              </Badge>
              <span className="text-xs text-gray-400">
                from {item.source_agent} ·{' '}
                <RelativeTime date={item.created_at} />
              </span>
            </div>
            <h3 className="font-semibold text-gray-900">{summarize(item)}</h3>
          </div>
        </div>

        <QueuePreview item={item} />

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <Textarea
            label="Reason (optional, but recommended for rejections)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="What was right or wrong about this draft? Future agent runs read recent reasons as few-shot examples."
          />
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {error}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => decide('approved')}
              loading={submitting === 'approve'}
              disabled={submitting !== null}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => decide('rejected')}
              loading={submitting === 'reject'}
              disabled={submitting !== null}
            >
              Reject
            </Button>
            {canRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={retryExecution}
                loading={submitting === 'retry'}
                disabled={submitting !== null}
              >
                Retry execution
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function summarize(item: ApprovalQueueRow): string {
  const p = item.payload as Record<string, unknown>
  switch (item.item_type) {
    case 'topic':
      return (p.title as string) ?? 'Topic proposal'
    case 'contribution': {
      const decisions = (p.decisions as unknown[]) ?? []
      return `${decisions.length} contribution${decisions.length === 1 ? '' : 's'} for ${p.topic_title ?? 'a topic'}`
    }
    case 'social_campaign':
      return `Drop campaign for "${p.artwork_title ?? 'artwork'}"`
    case 'email':
      return `${p.kind ?? 'Email'}: ${p.subject ?? '(no subject)'}`
    case 'comment_reply':
      return `Reply to ${p.classification ?? 'comment'}`
    case 'insight':
      return (p.headline as string) ?? 'Weekly insight'
    case 'artwork':
      return (p.title as string) ?? 'Artwork draft'
    case 'social_post':
      return `Single post: ${p.kind ?? ''}`
    default:
      return 'Pending item'
  }
}


