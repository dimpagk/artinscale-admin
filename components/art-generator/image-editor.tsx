'use client'

import { useState } from 'react'
import { PaperPlaneRight, ClockCounterClockwise } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { MODEL_OPTIONS, type GeneratedImage, type ModelKey } from '@/lib/constants/art-generator'

interface ImageEditorProps {
  image: GeneratedImage
  onEditComplete: (updated: GeneratedImage) => void
  onCancel: () => void
}

export function ImageEditor({ image, onEditComplete, onCancel }: ImageEditorProps) {
  const [instruction, setInstruction] = useState('')
  const [model, setModel] = useState<ModelKey>('flash')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const modelOptions = MODEL_OPTIONS.map((m) => ({
    value: m.key,
    label: m.label,
  }))

  const handleApplyEdit = async () => {
    if (!instruction.trim()) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/art-generator/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageId: image.id,
          instruction: instruction.trim(),
          model,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to apply edit')
      }

      const updated = await res.json()
      setInstruction('')
      onEditComplete(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {/* Left: Current image */}
      <div>
        <img
          src={image.image_url}
          alt={image.prompt}
          className="w-full rounded-lg shadow-md"
        />
        <p className="mt-2 text-sm italic text-gray-500">{image.prompt}</p>
      </div>

      {/* Right: Edit controls */}
      <div className="space-y-4">
        <Textarea
          label="Edit instruction"
          placeholder="Describe what to change..."
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={4}
        />

        <Select
          label="Model"
          options={modelOptions}
          value={model}
          onChange={(e) => setModel(e.target.value as ModelKey)}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={handleApplyEdit}
            loading={loading}
            disabled={!instruction.trim()}
            icon={<PaperPlaneRight size={16} />}
          >
            Apply Edit
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
        </div>

        {/* Edit history */}
        {image.edit_history && image.edit_history.length > 0 && (
          <div className="space-y-2 border-t border-gray-200 pt-4">
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <ClockCounterClockwise size={14} />
              Edit History
            </h4>
            <ul className="space-y-2">
              {image.edit_history.map((entry, i) => (
                <li key={i} className="rounded-md bg-gray-50 px-3 py-2">
                  <p className="text-sm text-gray-800">{entry.instruction}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(entry.timestamp).toLocaleString()} &middot; {entry.model}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
