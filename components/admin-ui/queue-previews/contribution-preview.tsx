import { StatusBadge } from '../status-badge'
import type { QueuePreviewProps } from './types'

export function ContributionPreview({ item }: QueuePreviewProps) {
  const p = item.payload as Record<string, unknown>
  return (
    <div className="text-sm text-gray-700">
      {Array.isArray(p.decisions) && (
        <ul className="space-y-1">
          {(p.decisions as Array<{ recommendation: string; preview: string; contributor_name: string }>)
            .slice(0, 6)
            .map((d, i) => (
              <li key={i} className="flex items-start gap-2">
                <RecommendationBadge recommendation={d.recommendation} />
                <span className="text-gray-600">
                  {d.contributor_name}: &quot;{d.preview}&quot;
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

function RecommendationBadge({ recommendation }: { recommendation: string }) {
  // Map agent recommendations to existing contribution-status variants
  // so the badge palette stays consistent across the admin.
  const status =
    recommendation === 'approve'
      ? 'approved'
      : recommendation === 'reject'
      ? 'rejected'
      : 'pending'
  return <StatusBadge domain="contribution" status={status} label={recommendation} />
}
