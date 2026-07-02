'use client'

import { useRef, useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'
import { FormCard } from '@/components/admin-ui'

interface ReferenceImagesProps {
  packId: string
  initialPaths: string[]
}

/**
 * Upload + manage the reference photos that show an artist's visual voice.
 * Uploads go to POST /api/style-packs/[id]/reference-image, which stores
 * them and keeps the URLs on the pack's referenceAssetPaths. Operates
 * independently of the main form's Save (its own async requests), so
 * uploads persist immediately and survive later form saves.
 */
export function ReferenceImages({ packId, initialPaths }: ReferenceImagesProps) {
  const [paths, setPaths] = useState<string[]>(initialPaths)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const endpoint = `/api/style-packs/${packId}/reference-image`

  const upload = async (files: FileList) => {
    setError(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(endpoint, { method: 'POST', body: fd })
        const data = (await res.json().catch(() => ({}))) as {
          paths?: string[]
          error?: string
        }
        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`)
        if (data.paths) setPaths(data.paths)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async (url: string) => {
    setError(null)
    const prev = paths
    setPaths(paths.filter((p) => p !== url))
    try {
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        paths?: string[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Remove failed')
      if (data.paths) setPaths(data.paths)
    } catch (err) {
      setPaths(prev)
      setError(err instanceof Error ? err.message : 'Remove failed')
    }
  }

  return (
    <FormCard
      title="Reference images"
      description="Photos that show this artist's look. Up to 4 feed the model as style references; approved exemplars from generations take priority. Max ~4 MB each."
    >
      <div className="flex flex-wrap gap-3">
        {paths.map((url) => (
          <div key={url} className="group relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="style reference"
              className="h-24 w-24 rounded-md border border-gray-200 object-cover"
            />
            <button
              type="button"
              onClick={() => remove(url)}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 shadow-sm hover:text-red-600"
              aria-label="Remove reference image"
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 disabled:opacity-50"
        >
          <Plus size={18} />
          <span className="text-xs">{uploading ? 'Uploading...' : 'Add photo'}</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void upload(e.target.files)
        }}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </FormCard>
  )
}
