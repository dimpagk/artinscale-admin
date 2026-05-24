import type { QueuePreviewProps } from './types'

export function SocialCampaignPreview({ item }: QueuePreviewProps) {
  const p = item.payload as Record<string, unknown>
  return (
    <div className="space-y-2 text-sm text-gray-700">
      {Array.isArray(p.posts) &&
        (p.posts as Array<{ kind: string; caption: string }>).map((post, i) => (
          <div key={i} className="border-l-2 border-gray-200 pl-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {post.kind}
            </p>
            <p className="line-clamp-3 whitespace-pre-line">{post.caption}</p>
          </div>
        ))}
    </div>
  )
}
