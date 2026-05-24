import type { QueuePreviewProps } from './types'

/**
 * Fallback preview when the queue receives an item_type with no
 * dedicated preview component yet. Renders the payload as truncated
 * JSON so the operator can still inspect it.
 */
export function JsonPreview({ item }: QueuePreviewProps) {
  return (
    <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-700">
      {JSON.stringify(item.payload, null, 2).slice(0, 1000)}
    </pre>
  )
}
