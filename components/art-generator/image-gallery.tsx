'use client'

import { Trash, ImageSquare } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import type { GeneratedImage } from '@/lib/constants/art-generator'

interface ImageGalleryProps {
  images: GeneratedImage[]
  onSelect: (image: GeneratedImage) => void
  onDelete: (id: string) => void
}

export function ImageGallery({ images, onSelect, onDelete }: ImageGalleryProps) {
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
        <ImageSquare size={48} weight="thin" />
        <p className="text-sm">No generated images yet</p>
      </div>
    )
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (window.confirm('Are you sure you want to delete this image?')) {
      onDelete(id)
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {images.map((image) => {
        const date = new Date(image.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })

        return (
          <div
            key={image.id}
            onClick={() => onSelect(image)}
            className="group cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-white transition-shadow hover:shadow-md"
          >
            <div className="relative aspect-square overflow-hidden">
              <img
                src={image.image_url}
                alt={image.prompt}
                className="h-full w-full object-cover"
              />
              <button
                onClick={(e) => handleDelete(e, image.id)}
                className="absolute right-2 top-2 rounded-md bg-white/90 p-1.5 text-gray-500 opacity-0 shadow-sm transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                aria-label="Delete image"
              >
                <Trash size={14} />
              </button>
            </div>
            <div className="space-y-1.5 p-2.5">
              <p className="line-clamp-2 text-xs text-gray-700">{image.prompt}</p>
              <div className="flex items-center gap-1.5">
                {image.style_preset && (
                  <Badge variant="secondary" size="sm">
                    {image.style_preset}
                  </Badge>
                )}
                <Badge variant="outline" size="sm">
                  {image.model}
                </Badge>
              </div>
              <p className="text-xs text-gray-400">{date}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
