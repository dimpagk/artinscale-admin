'use client'

import { useState } from 'react'
import {
  PencilSimple,
  ArrowClockwise,
  Link as LinkIcon,
  DownloadSimple,
  Trash,
  PaintBrush,
  Image as ImageIcon,
  Article,
  ArrowsOutSimple,
  Palette,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { VectorStudio } from './vector-studio'
import { listLaunchStylePacks } from '@/lib/style-packs'
import type { GeneratedImage } from '@/lib/constants/art-generator'

interface GenerationPanelProps {
  image: GeneratedImage | null
  loading: boolean
  /** Last batch of generated images (Tier 2 #5 — side-by-side comparison) */
  recentBatch?: GeneratedImage[]
  /** Streaming progress state during a multi-variation batch */
  batchProgress?: { done: number; total: number } | null
  /** Switch the focused image to a sibling from the recent batch */
  onSelectBatchSibling?: (image: GeneratedImage) => void
  onEdit: () => void
  onRegenerate: () => void
  onLinkArtwork: () => void
  onDownload: () => void
  onDelete: () => void
  onUseInPost?: () => void
  onUpdate?: (image: GeneratedImage) => void
}

export function GenerationPanel({
  image,
  loading,
  recentBatch,
  batchProgress,
  onSelectBatchSibling,
  onEdit,
  onRegenerate,
  onLinkArtwork,
  onDownload,
  onDelete,
  onUseInPost,
  onUpdate,
}: GenerationPanelProps) {
  const [upscaling, setUpscaling] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [transferTarget, setTransferTarget] = useState<string>('')
  const [showTransferPicker, setShowTransferPicker] = useState(false)

  const currentStylePackId = (image?.metadata as Record<string, unknown> | null)?.stylePackId as
    | string
    | undefined
  const transferOptions = listLaunchStylePacks()
    .filter((p) => p.id !== currentStylePackId)
    .map((p) => ({ value: p.id, label: `${p.persona.name} — ${p.persona.tagline}` }))

  const handleTransfer = async () => {
    if (!image || !transferTarget) return
    setTransferring(true)
    try {
      const res = await fetch(`/api/art-generator/${image.id}/style-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_style_pack_id: transferTarget }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Transfer failed (${res.status})`)
      }
      const { image: transferred } = (await res.json()) as { image: GeneratedImage }
      onUpdate?.(transferred)
      setShowTransferPicker(false)
      setTransferTarget('')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Transfer failed')
    } finally {
      setTransferring(false)
    }
  }

  const handleUpscale = async () => {
    if (!image) return
    setUpscaling(true)
    try {
      const res = await fetch(`/api/art-generator/${image.id}/upscale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale: 4 }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Upscale failed (${res.status})`)
      }
      const { image: updated, dimensions, isDryRun } = (await res.json()) as {
        image: GeneratedImage
        dimensions: { width: number; height: number } | null
        isDryRun: boolean
      }
      onUpdate?.(updated)
      const dim = dimensions ? `${dimensions.width}×${dimensions.height}px` : 'unknown size'
      window.alert(
        isDryRun
          ? `Upscale dry-run: passed through original at ${dim}. Set REPLICATE_API_TOKEN + remove UPSCALER_DRY_RUN for real 4× upscaling.`
          : `Upscaled to ${dim}. Future Gelato pushes will use this version.`
      )
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Upscale failed')
    } finally {
      setUpscaling(false)
    }
  }
  if (loading) {
    const progressLabel = batchProgress
      ? `Generating ${batchProgress.done + 1} of ${batchProgress.total}…`
      : 'Generating artwork…'
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20">
        <svg
          className="h-8 w-8 animate-spin text-gray-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <p className="text-sm text-gray-500">{progressLabel}</p>
        {recentBatch && recentBatch.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {recentBatch.map((sib) => (
              <button
                key={sib.id}
                onClick={() => onSelectBatchSibling?.(sib)}
                className="h-16 w-16 overflow-hidden rounded border border-gray-200 hover:border-gray-400"
                title={sib.prompt}
              >
                <img src={sib.image_url} alt={sib.prompt} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!image) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-gray-400">
        <PaintBrush size={48} weight="thin" />
        <p className="text-sm">Generate your first artwork</p>
      </div>
    )
  }

  const createdDate = new Date(image.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="overflow-hidden rounded-lg shadow-md">
        <img
          src={image.image_url}
          alt={image.prompt}
          className="w-full max-w-2xl rounded-lg object-contain"
        />
      </div>

      {/* Side-by-side comparison strip after a multi-variation batch */}
      {recentBatch && recentBatch.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-700">
            Just generated · {recentBatch.length} variations
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {recentBatch.map((sib) => {
              const isCurrent = sib.id === image.id
              return (
                <button
                  key={sib.id}
                  onClick={() => onSelectBatchSibling?.(sib)}
                  className={`h-20 w-20 overflow-hidden rounded border-2 transition-colors ${
                    isCurrent
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                  title={sib.prompt}
                >
                  <img src={sib.image_url} alt={sib.prompt} className="h-full w-full object-cover" />
                </button>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-sm italic text-gray-500">{image.prompt}</p>

      <div className="flex flex-wrap items-center gap-2">
        {image.style_preset && (
          <Badge variant="secondary" size="sm">
            {image.style_preset}
          </Badge>
        )}
        <Badge variant="outline" size="sm">
          {image.model}
        </Badge>
        <span className="text-xs text-gray-400">{createdDate}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onEdit} icon={<PencilSimple size={14} />}>
          Edit
        </Button>
        <Button variant="outline" size="sm" onClick={onRegenerate} icon={<ArrowClockwise size={14} />}>
          Regenerate
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpscale}
          loading={upscaling}
          icon={<ArrowsOutSimple size={14} />}
        >
          {(image.metadata as Record<string, unknown> | null)?.upscaledImageUrl
            ? 'Re-upscale'
            : 'Upscale 4×'}
        </Button>
        {transferOptions.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTransferPicker((v) => !v)}
            icon={<Palette size={14} />}
          >
            Transfer style
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onLinkArtwork} icon={<LinkIcon size={14} />}>
          Link to Artwork
        </Button>
        <Button variant="outline" size="sm" onClick={onDownload} icon={<DownloadSimple size={14} />}>
          Download
        </Button>
        {onUseInPost && (
          <Button variant="primary" size="sm" onClick={onUseInPost} icon={<Article size={14} />}>
            Use in Post
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={onDelete} icon={<Trash size={14} />}>
          Delete
        </Button>
      </div>

      {/* Style transfer picker — opens when "Transfer style" is clicked.
          Uses the current image as composition reference + a different
          artist's voice as the new render target. */}
      {showTransferPicker && transferOptions.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-gray-300 bg-gray-50 p-3">
          <div className="min-w-[260px] flex-1">
            <Select
              label="Re-render in this artist's voice"
              options={[{ value: '', label: 'Pick artist…' }, ...transferOptions]}
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              helperText="Same composition, new visual voice. ~12s + Gemini cost."
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleTransfer}
            loading={transferring}
            disabled={!transferTarget}
          >
            Transfer
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowTransferPicker(false)
              setTransferTarget('')
            }}
            disabled={transferring}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Vector studio — Tier 5 of the AI Art pipeline.
          One composition × N palette variants = N Gelato-pushable SKUs. */}
      {onUpdate && <VectorStudio image={image} onUpdate={onUpdate} />}
    </div>
  )
}
