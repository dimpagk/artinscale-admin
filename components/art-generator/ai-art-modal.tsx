'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { PromptBuilder } from './prompt-builder'
import { GenerationPanel } from './generation-panel'
import type { GeneratedImage, GenerateParams } from '@/lib/constants/art-generator'

interface AiArtModalProps {
  open: boolean
  onClose: () => void
  onSelect: (imageUrl: string) => void
}

export function AiArtModal({ open, onClose, onSelect }: AiArtModalProps) {
  const [image, setImage] = useState<GeneratedImage | null>(null)
  const [loading, setLoading] = useState(false)

  const handleGenerate = async (params: GenerateParams) => {
    setLoading(true)
    try {
      const res = await fetch('/api/art-generator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Generation failed')
      }

      const generated = await res.json()
      setImage(generated)
    } catch (err) {
      console.error('Generation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleUseImage = () => {
    if (image) {
      onSelect(image.image_url)
      onClose()
      setImage(null)
    }
  }

  const handleClose = () => {
    onClose()
    setImage(null)
  }

  return (
    <Modal isOpen={open} onClose={handleClose} title="Generate AI Art" size="xl">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <PromptBuilder onGenerate={handleGenerate} loading={loading} />
        </div>
        <div>
          <GenerationPanel
            image={image}
            loading={loading}
            onEdit={() => {}}
            onRegenerate={() => image && handleGenerate({ prompt: image.prompt, model: image.model as 'flash' | 'pro', aspectRatio: image.aspect_ratio as '1:1' })}
            onLinkArtwork={() => {}}
            onDownload={() => {
              if (image) {
                const a = document.createElement('a')
                a.href = image.image_url
                a.download = `artinscale-${image.id}.png`
                a.click()
              }
            }}
            onDelete={() => {}}
            onUseInPost={image ? handleUseImage : undefined}
          />
        </div>
      </div>
    </Modal>
  )
}
