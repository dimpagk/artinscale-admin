'use client'

import { useState } from 'react'
import { Tabs } from '@/components/ui/tabs'
import { PromptBuilder } from '@/components/art-generator/prompt-builder'
import { TopicContextPicker } from '@/components/art-generator/topic-context-picker'
import { GenerationPanel } from '@/components/art-generator/generation-panel'
import { ImageEditor } from '@/components/art-generator/image-editor'
import { ImageGallery } from '@/components/art-generator/image-gallery'
import type { GeneratedImage, GenerateParams } from '@/lib/constants/art-generator'
import type { TopicRow } from '@/lib/types'

interface ArtGeneratorClientProps {
  initialImages: GeneratedImage[]
  topics: TopicRow[]
}

const TABS = [
  { id: 'generate', label: 'Generate' },
  { id: 'gallery', label: 'Gallery' },
]

export function ArtGeneratorClient({ initialImages, topics }: ArtGeneratorClientProps) {
  const [activeTab, setActiveTab] = useState('generate')
  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState<GeneratedImage[]>(initialImages)
  const [contributionContext, setContributionContext] = useState('')

  const handleGenerate = async (params: GenerateParams) => {
    setLoading(true)
    try {
      const body = {
        ...params,
        ...(contributionContext && { contributionContext }),
      }

      const res = await fetch('/api/art-generator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Generation failed')
      }

      const generated: GeneratedImage = await res.json()
      setCurrentImage(generated)
      setImages((prev) => [generated, ...prev])
    } catch (err) {
      console.error('Generation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/art-generator/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')

      setImages((prev) => prev.filter((img) => img.id !== id))
      if (currentImage?.id === id) {
        setCurrentImage(null)
        setEditMode(false)
      }
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const handleDownload = () => {
    if (!currentImage) return
    const a = document.createElement('a')
    a.href = currentImage.image_url
    a.download = `artinscale-${currentImage.id}.png`
    a.click()
  }

  const handleEditComplete = (updated: GeneratedImage) => {
    setCurrentImage(updated)
    setImages((prev) => prev.map((img) => (img.id === updated.id ? updated : img)))
    setEditMode(false)
  }

  const handleGallerySelect = (image: GeneratedImage) => {
    setCurrentImage(image)
    setEditMode(false)
    setActiveTab('generate')
  }

  return (
    <>
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === 'generate' && (
          <div className="flex gap-6">
            {/* Left sidebar */}
            <div className="w-[320px] shrink-0 space-y-6">
              <PromptBuilder onGenerate={handleGenerate} loading={loading} />
              <TopicContextPicker topics={topics} onContextChange={setContributionContext} />
            </div>

            {/* Center panel */}
            <div className="min-w-0 flex-1">
              {editMode && currentImage ? (
                <ImageEditor
                  image={currentImage}
                  onEditComplete={handleEditComplete}
                  onCancel={() => setEditMode(false)}
                />
              ) : (
                <GenerationPanel
                  image={currentImage}
                  loading={loading}
                  onEdit={() => setEditMode(true)}
                  onRegenerate={() => {
                    if (currentImage) {
                      handleGenerate({
                        prompt: currentImage.prompt,
                        model: currentImage.model as 'flash' | 'pro',
                        aspectRatio: currentImage.aspect_ratio as '1:1',
                      })
                    }
                  }}
                  onLinkArtwork={() => {}}
                  onDownload={handleDownload}
                  onDelete={() => currentImage && handleDelete(currentImage.id)}
                />
              )}
            </div>
          </div>
        )}

        {activeTab === 'gallery' && (
          <ImageGallery
            images={images}
            onSelect={handleGallerySelect}
            onDelete={handleDelete}
          />
        )}
      </div>
    </>
  )
}
