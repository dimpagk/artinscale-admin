import { Badge } from '@/components/ui/badge'
import type { QueuePreviewProps } from './types'

export function CommentReplyPreview({ item }: QueuePreviewProps) {
  const p = item.payload as Record<string, unknown>
  return (
    <div className="space-y-2 text-sm text-gray-700">
      <p className="italic text-gray-500">
        {(p.classification as string) ?? 'comment'}
        {p.flag_for_human ? (
          <>
            {' · '}
            <Badge variant="warning" size="sm">
              Flagged for human
            </Badge>
          </>
        ) : null}
      </p>
      <div className="border-l-2 border-gray-200 pl-3 italic">
        {p.reply_text as string}
      </div>
      {typeof p.reasoning === 'string' && p.reasoning && (
        <p className="text-xs text-gray-500">Why: {p.reasoning}</p>
      )}
    </div>
  )
}
