'use client'

import { useMemo, useState } from 'react'
import { Trash, ImageSquare, LinkSimple, Star } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { listStylePacks } from '@/lib/style-packs'
import type { GeneratedImage } from '@/lib/constants/art-generator'

interface ImageGalleryProps {
  images: GeneratedImage[]
  onSelect: (image: GeneratedImage) => void
  onDelete: (id: string) => void
  onUpdate?: (image: GeneratedImage) => void
}

type SortKey = 'newest' | 'oldest' | 'similarity_desc' | 'similarity_asc'

interface ImageDimensionRecord {
  width: number
  height: number
}

function getDimensions(img: GeneratedImage): ImageDimensionRecord | null {
  const meta = img.metadata as Record<string, unknown> | undefined
  const upscaled = meta?.upscaledDimensions as ImageDimensionRecord | undefined
  if (upscaled?.width && upscaled?.height) return upscaled
  const measured = meta?.measuredDimensions as ImageDimensionRecord | undefined
  if (measured?.width && measured?.height) return measured
  return null
}

function getCost(img: GeneratedImage): number | null {
  const meta = img.metadata as Record<string, unknown> | undefined
  const cost = meta?.estimatedCostUsd
  return typeof cost === 'number' ? cost : null
}

interface VisualTags {
  subjectKind?: string
  moods?: string[]
  composition?: string[]
  oneLineDescription?: string
}

function getTags(img: GeneratedImage): VisualTags | null {
  const meta = img.metadata as Record<string, unknown> | undefined
  const tags = meta?.tags
  if (typeof tags === 'object' && tags !== null) return tags as VisualTags
  return null
}

const STYLE_PACK_LABEL: Record<string, string> = listStylePacks().reduce(
  (acc, p) => ({ ...acc, [p.id]: p.persona.name }),
  {}
)

export function ImageGallery({ images, onSelect, onDelete, onUpdate }: ImageGalleryProps) {
  const [stylePackFilter, setStylePackFilter] = useState<string>('')
  const [topicFilter, setTopicFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [linkedFilter, setLinkedFilter] = useState<string>('')
  const [exemplarFilter, setExemplarFilter] = useState<string>('')
  const [subjectFilter, setSubjectFilter] = useState<string>('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const toggleSelected = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  const bulkDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`Delete ${selected.size} image${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      // Sequential to avoid hammering the route + give clearer error reporting
      for (const id of selected) {
        await Promise.resolve(onDelete(id))
      }
      clearSelection()
    } finally {
      setBulkDeleting(false)
    }
  }

  const toggleExemplar = async (e: React.MouseEvent, img: GeneratedImage) => {
    e.stopPropagation()
    const isExemplar = (img.metadata as Record<string, unknown> | null)?.exemplar === true
    setTogglingId(img.id)
    try {
      const res = await fetch(`/api/art-generator/${img.id}/exemplar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exemplar: !isExemplar }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed (${res.status})`)
      }
      const { image } = (await res.json()) as { image: GeneratedImage }
      onUpdate?.(image)
    } catch (err) {
      console.error('Toggle exemplar failed:', err)
      window.alert(err instanceof Error ? err.message : 'Toggle failed')
    } finally {
      setTogglingId(null)
    }
  }

  // Build filter options from the current image set so the dropdowns
  // only show values that exist.
  const { topicOptions, stylePackOptions, sourceOptions, subjectOptions } = useMemo(() => {
    const topics = new Set<string>()
    const stylePacks = new Set<string>()
    const sources = new Set<string>()
    const subjects = new Set<string>()
    for (const img of images) {
      if (img.topic_id) topics.add(img.topic_id)
      const meta = img.metadata as Record<string, unknown> | undefined
      const sp = meta?.stylePackId
      if (typeof sp === 'string' && sp) stylePacks.add(sp)
      const src = meta?.source
      if (typeof src === 'string' && src) sources.add(src)
      const tags = getTags(img)
      if (tags?.subjectKind && tags.subjectKind !== 'unknown') subjects.add(tags.subjectKind)
    }
    return {
      topicOptions: [
        { value: '', label: 'All topics' },
        ...[...topics].sort().map((t) => ({ value: t, label: t })),
      ],
      stylePackOptions: [
        { value: '', label: 'All artists' },
        ...[...stylePacks].map((id) => ({ value: id, label: STYLE_PACK_LABEL[id] ?? id })),
      ],
      sourceOptions: [
        { value: '', label: 'All sources' },
        ...[...sources].map((s) => ({ value: s, label: s })),
      ],
      subjectOptions: [
        { value: '', label: 'All subjects' },
        ...[...subjects].sort().map((s) => ({ value: s, label: s })),
      ],
    }
  }, [images])

  const filtered = useMemo(() => {
    const list = images.filter((img) => {
      const meta = img.metadata as Record<string, unknown> | undefined
      if (stylePackFilter && meta?.stylePackId !== stylePackFilter) return false
      if (topicFilter && img.topic_id !== topicFilter) return false
      if (sourceFilter && meta?.source !== sourceFilter) return false
      if (linkedFilter === 'linked' && !img.artwork_id) return false
      if (linkedFilter === 'unlinked' && img.artwork_id) return false
      if (exemplarFilter === 'exemplars' && meta?.exemplar !== true) return false
      if (exemplarFilter === 'non_exemplars' && meta?.exemplar === true) return false
      if (subjectFilter) {
        const tags = getTags(img)
        if (tags?.subjectKind !== subjectFilter) return false
      }
      return true
    })

    const score = (img: GeneratedImage): number => {
      const meta = img.metadata as Record<string, unknown> | undefined
      const ss = meta?.styleSimilarity as { score?: number } | undefined
      return typeof ss?.score === 'number' ? ss.score : -1
    }

    switch (sort) {
      case 'oldest':
        return [...list].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      case 'similarity_desc':
        return [...list].sort((a, b) => score(b) - score(a))
      case 'similarity_asc':
        return [...list].sort((a, b) => score(a) - score(b))
      default:
        return [...list].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
    }
  }, [images, stylePackFilter, topicFilter, sourceFilter, linkedFilter, exemplarFilter, subjectFilter, sort])

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (window.confirm('Are you sure you want to delete this image?')) {
      onDelete(id)
    }
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
        <ImageSquare size={48} weight="thin" />
        <p className="text-sm">No generated images yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter + sort bar */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
        <Select
          label="Artist"
          options={stylePackOptions}
          value={stylePackFilter}
          onChange={(e) => setStylePackFilter(e.target.value)}
        />
        <Select
          label="Topic"
          options={topicOptions}
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
        />
        <Select
          label="Source"
          options={sourceOptions}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        />
        <Select
          label="Linked"
          options={[
            { value: '', label: 'All' },
            { value: 'linked', label: 'Linked to artwork' },
            { value: 'unlinked', label: 'Not linked' },
          ]}
          value={linkedFilter}
          onChange={(e) => setLinkedFilter(e.target.value)}
        />
        <Select
          label="Exemplars"
          options={[
            { value: '', label: 'All' },
            { value: 'exemplars', label: '★ Exemplars only' },
            { value: 'non_exemplars', label: 'Not yet exemplars' },
          ]}
          value={exemplarFilter}
          onChange={(e) => setExemplarFilter(e.target.value)}
        />
        <Select
          label="Subject"
          options={subjectOptions}
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
        />
        <Select
          label="Sort"
          options={[
            { value: 'newest', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'similarity_desc', label: 'Most on-style' },
            { value: 'similarity_asc', label: 'Least on-style' },
          ]}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <p>
          Showing {filtered.length} of {images.length}
          {selected.size > 0 && (
            <span className="ml-2 text-gray-700">
              · {selected.size} selected
            </span>
          )}
        </p>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-gray-500 underline-offset-2 hover:underline"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={bulkDelete}
              disabled={bulkDeleting}
              className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {bulkDeleting ? 'Deleting…' : `Delete ${selected.size}`}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((image) => {
          const date = new Date(image.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
          const meta = image.metadata as Record<string, unknown> | undefined
          const stylePackId = meta?.stylePackId as string | undefined
          const isExemplar = meta?.exemplar === true
          const isSelected = selected.has(image.id)
          const dims = getDimensions(image)
          const cost = getCost(image)
          const styleSimilarity = meta?.styleSimilarity as
            | { score?: number; suggestedAction?: string }
            | undefined
          const score = styleSimilarity?.score
          const scoreColor =
            typeof score !== 'number'
              ? null
              : score >= 0.85
              ? 'success'
              : score >= 0.6
              ? 'warning'
              : 'secondary'

          return (
            <div
              key={image.id}
              onClick={() => onSelect(image)}
              className={`group cursor-pointer overflow-hidden rounded-lg border bg-white transition-shadow hover:shadow-md ${
                isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
              }`}
            >
              <div className="relative aspect-square overflow-hidden">
                <img
                  src={image.image_url}
                  alt={image.prompt}
                  className="h-full w-full object-cover"
                />
                {typeof score === 'number' && scoreColor && (
                  <div className="absolute left-2 top-2">
                    <Badge variant={scoreColor} size="sm">
                      {Math.round(score * 100)}% on-style
                    </Badge>
                  </div>
                )}
                {image.artwork_id && (
                  <div className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    <LinkSimple size={10} weight="bold" className="-mt-0.5 mr-0.5 inline" />
                    Linked
                  </div>
                )}
                {isExemplar && (
                  <div className="absolute bottom-2 right-2 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
                    <Star size={10} weight="fill" className="-mt-0.5 mr-0.5 inline" />
                    Exemplar
                  </div>
                )}
                <button
                  onClick={(e) => toggleExemplar(e, image)}
                  disabled={togglingId === image.id || (!isExemplar && !stylePackId)}
                  className={`absolute right-2 top-10 rounded-md p-1.5 shadow-sm transition-opacity disabled:opacity-30 ${
                    isExemplar
                      ? 'bg-amber-400 text-amber-950 hover:bg-amber-300 opacity-100'
                      : 'bg-white/90 text-gray-500 opacity-0 hover:bg-amber-50 hover:text-amber-600 group-hover:opacity-100'
                  }`}
                  aria-label={isExemplar ? 'Unmark as exemplar' : 'Mark as exemplar'}
                  title={isExemplar ? 'Unmark as exemplar' : stylePackId ? 'Mark as exemplar' : 'Needs a style pack to mark'}
                >
                  <Star size={14} weight={isExemplar ? 'fill' : 'regular'} />
                </button>
                <button
                  onClick={(e) => handleDelete(e, image.id)}
                  className="absolute right-2 top-2 rounded-md bg-white/90 p-1.5 text-gray-500 opacity-0 shadow-sm transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                  aria-label="Delete image"
                >
                  <Trash size={14} />
                </button>
                {/* Multi-select checkbox in top-left */}
                <label
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute left-2 top-2 flex h-5 w-5 cursor-pointer items-center justify-center rounded border bg-white shadow-sm transition-opacity ${
                    isSelected ? 'border-blue-500 bg-blue-500 opacity-100' : 'border-gray-300 opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => toggleSelected(e as unknown as React.MouseEvent, image.id)}
                    className="sr-only"
                  />
                  {isSelected && <span className="text-xs text-white">✓</span>}
                </label>
              </div>
              <div className="space-y-1.5 p-2.5">
                <p className="line-clamp-2 text-xs text-gray-700">{image.prompt}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {stylePackId && (
                    <Badge variant="secondary" size="sm">
                      {STYLE_PACK_LABEL[stylePackId] ?? stylePackId}
                    </Badge>
                  )}
                  {image.topic_id && (
                    <Badge variant="outline" size="sm">
                      {image.topic_id}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 text-[10px] text-gray-400">
                  <span>{date}</span>
                  {dims && (
                    <span className="font-mono" title={`${dims.width}×${dims.height} px`}>
                      {dims.width}×{dims.height}
                    </span>
                  )}
                  {typeof cost === 'number' && (
                    <span className="text-gray-500" title={`Estimated cost: $${cost.toFixed(3)}`}>
                      ${cost.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-gray-400">
          No images match these filters.
        </p>
      )}
    </div>
  )
}
