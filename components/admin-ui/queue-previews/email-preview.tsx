import type { QueuePreviewProps } from './types'

export function EmailPreview({ item }: QueuePreviewProps) {
  const p = item.payload as Record<string, unknown>
  const recipients = Array.isArray(p.to)
    ? (p.to as string[]).join(', ')
    : (p.to as string)

  return (
    <div className="space-y-1 text-sm text-gray-700">
      <p>
        <span className="font-medium">To:</span> {recipients}
      </p>
      <p>
        <span className="font-medium">Subject:</span> {p.subject as string}
      </p>
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">Preview HTML</summary>
        <iframe
          srcDoc={p.html as string}
          className="mt-2 h-64 w-full border border-gray-200"
          title="Email preview"
        />
      </details>
    </div>
  )
}
