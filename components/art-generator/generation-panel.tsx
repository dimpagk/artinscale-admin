'use client'

import {
  PencilSimple,
  ArrowClockwise,
  Link as LinkIcon,
  DownloadSimple,
  Trash,
  PaintBrush,
  Image as ImageIcon,
  Article,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { GeneratedImage } from '@/lib/constants/art-generator'

interface GenerationPanelProps {
  image: GeneratedImage | null
  loading: boolean
  onEdit: () => void
  onRegenerate: () => void
  onLinkArtwork: () => void
  onDownload: () => void
  onDelete: () => void
  onUseInPost?: () => void
}

export function GenerationPanel({
  image,
  loading,
  onEdit,
  onRegenerate,
  onLinkArtwork,
  onDownload,
  onDelete,
  onUseInPost,
}: GenerationPanelProps) {
  if (loading) {
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
        <p className="text-sm text-gray-500">Generating artwork...</p>
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
    </div>
  )
}
