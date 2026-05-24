import type { QueuePreviewProps } from './types'

export function InsightPreview({ item }: QueuePreviewProps) {
  const p = item.payload as Record<string, unknown>
  return (
    <div className="space-y-2 text-sm text-gray-700">
      <p className="whitespace-pre-line">{p.summary_md as string}</p>
      {Array.isArray(p.recommended_actions) && (
        <ul className="ml-5 list-disc text-gray-600">
          {(p.recommended_actions as Array<{ action: string; rationale: string }>)
            .slice(0, 4)
            .map((a, i) => (
              <li key={i}>
                <span className="font-medium">{a.action}</span>
                {' — '}
                <span className="text-gray-500">{a.rationale}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
