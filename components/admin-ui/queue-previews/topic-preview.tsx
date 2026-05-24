import type { QueuePreviewProps } from './types'

export function TopicPreview({ item }: QueuePreviewProps) {
  const p = item.payload as Record<string, unknown>
  return (
    <div className="space-y-1 text-sm text-gray-700">
      <p className="italic">{String(p.short_description ?? '')}</p>
      {typeof p.long_description === 'string' && p.long_description && (
        <p>{p.long_description}</p>
      )}
      {Array.isArray(p.prompts) && (
        <ul className="ml-5 list-disc text-gray-600">
          {(p.prompts as string[]).slice(0, 3).map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      )}
      {typeof p.rationale === 'string' && p.rationale && (
        <p className="mt-2 text-xs text-gray-500">Rationale: {p.rationale}</p>
      )}
    </div>
  )
}
