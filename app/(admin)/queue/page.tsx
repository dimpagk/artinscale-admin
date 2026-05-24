import Link from 'next/link'
import { listPendingItems, pendingCountByType, type ApprovalQueueRow } from '@/lib/queue'
import { getContributionStats } from '@/lib/contributions'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, EmptyState, FilterChip } from '@/components/admin-ui'
import { QueueItem } from './queue-item'

export const dynamic = 'force-dynamic'

const ITEM_TYPE_LABELS: Record<string, string> = {
  topic: 'Topics',
  contribution: 'Contributions',
  artwork: 'Artworks',
  social_campaign: 'Drop campaigns',
  social_post: 'Single posts',
  email: 'Emails',
  comment_reply: 'Comment replies',
  insight: 'Insights',
}

export default async function QueuePage(props: {
  searchParams: Promise<{ type?: string }>
}) {
  const params = await props.searchParams
  const filter = params.type as ApprovalQueueRow['item_type'] | undefined

  const [items, counts, contributionStats] = await Promise.all([
    listPendingItems({ itemType: filter, limit: 100 }),
    pendingCountByType(),
    getContributionStats(),
  ])

  const totalPending = Object.values(counts).reduce((a, b) => a + b, 0)
  const pendingContributions = contributionStats.pending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Inbox"
        description={
          totalPending === 0
            ? 'No pending items. Agents will drop drafts here for review.'
            : `${totalPending} pending item${totalPending === 1 ? '' : 's'}.`
        }
      />

      {pendingContributions > 0 && (
        <Link
          href="/contributions?status=pending"
          className="block rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 transition-colors hover:bg-amber-100"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-amber-900">
                {pendingContributions} contribution{pendingContributions === 1 ? '' : 's'} awaiting review
              </p>
              <p className="text-xs text-amber-700">
                Community submissions and seeded contributions go straight to the Contributions screen.
              </p>
            </div>
            <Badge variant="warning" size="sm">{pendingContributions}</Badge>
          </div>
        </Link>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <FilterChip label="All" href="/queue" active={!filter} count={totalPending} />
        {Object.entries(ITEM_TYPE_LABELS).map(([type, label]) => (
          <FilterChip
            key={type}
            label={label}
            href={`/queue?type=${type}`}
            active={filter === type}
            count={counts[type as ApprovalQueueRow['item_type']] ?? 0}
          />
        ))}
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <Card>
          <EmptyState
            title={filter ? `Nothing in "${ITEM_TYPE_LABELS[filter] ?? filter}"` : 'Inbox is empty'}
            description={
              filter
                ? 'Try a different filter, or wait for the next agent run.'
                : 'When agents draft topics, social campaigns, comments or insights, they appear here for your approval.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <QueueItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

