'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'
import { PromptBuilder } from '@/components/art-generator/prompt-builder'
import { TopicContextPicker } from '@/components/art-generator/topic-context-picker'
import { GenerationPanel } from '@/components/art-generator/generation-panel'
import { ArtStudio } from '@/components/art-generator/art-studio'
import { ImageGallery } from '@/components/art-generator/image-gallery'
import type { GeneratedImage, GenerateParams } from '@/lib/constants/art-generator'
import type { TopicRow } from '@/lib/types'
import { getArtistIdForStylePack, listLaunchStylePacks } from '@/lib/style-packs'

interface ArtGeneratorClientProps {
  initialImages: GeneratedImage[]
  topics: TopicRow[]
}

const TABS = [
  { id: 'generate', label: 'Generate' },
  { id: 'gallery', label: 'Gallery' },
]

export function ArtGeneratorClient({ initialImages, topics }: ArtGeneratorClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState('generate')
  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState<GeneratedImage[]>(initialImages)
  const [contributionContext, setContributionContext] = useState('')
  // Lifted prompt state so the cluster picker's "Use suggested
  // subject" button can push values into the prompt textarea. The
  // PromptBuilder is now a controlled input — see its `value` +
  // `onChange` props below.
  const [promptValue, setPromptValue] = useState('')
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  // Tracks the most recent batch of generated images so the UI can
  // show them side-by-side for comparison (Tier 2 #5). Cleared on each
  // new batch start; populated as generations stream in.
  const [recentBatch, setRecentBatch] = useState<GeneratedImage[]>([])

  /**
   * Pre-load contribution context when the page is opened from a "✨ Generate"
   * link on the Contributions page. Fetches the seed contribution and
   * primes the contributionContext state so the generator already has
   * inspiration loaded.
   */
  useEffect(() => {
    const seedId = searchParams.get('seedContributionId')
    if (!seedId) return

    void (async () => {
      try {
        const topicId = searchParams.get('topicId')
        if (!topicId) return
        const res = await fetch(`/api/topics/${topicId}/contributions?limit=10`)
        if (!res.ok) return
        const data = (await res.json()) as {
          contributions: Array<{ id: string; contributor_name: string; contributor_location: string | null; type: string; content: string; caption: string | null }>
        }
        const seed = data.contributions.find((c) => c.id === seedId)
        if (!seed) return
        const where = seed.contributor_location ? ` (${seed.contributor_location})` : ''
        const text = seed.type === 'story' ? seed.content : seed.caption ?? ''
        const formatted = `${seed.contributor_name}${where}: "${(text ?? '').trim().slice(0, 280)}"`
        setContributionContext(formatted)
      } catch {
        // ignore — non-fatal pre-fill
      }
    })()
  }, [searchParams])

  /**
   * Promote a generated image to a draft artwork, then jump to its
   * edit page so the operator can finish the title / edition / price.
   *
   * Inferred fields (overrideable on the next page):
   *   - image_url     ← from the generated image
   *   - artist_id     ← from the generated_images.metadata.stylePackPersonaUserId
   *   - topic_id      ← from generated_images.topic_id
   *   - title         ← derived from the prompt
   *   - product_type  ← 'poster' (the only launch-enabled SKU)
   */
  const handleLinkArtwork = async () => {
    if (!currentImage) return
    setLoading(true)
    try {
      const meta = currentImage.metadata as Record<string, unknown> | null
      const stylePackId = (meta?.stylePackId as string | undefined) ?? null
      const inferredArtistId =
        (meta?.stylePackPersonaUserId as string | undefined) ??
        getArtistIdForStylePack(stylePackId)

      const titleFromPrompt = currentImage.prompt
        .split(/[,.;]/)[0]
        .trim()
        .slice(0, 80)
        .replace(/^./, (c) => c.toUpperCase())

      const res = await fetch('/api/art-generator/promote-to-artwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generated_image_id: currentImage.id,
          title: titleFromPrompt || 'Untitled',
          image_url: currentImage.image_url,
          artist_id: inferredArtistId,
          topic_id: currentImage.topic_id,
          product_type: 'museum-poster-21x30',
          inspiration_summary: currentImage.prompt,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Promote failed (${res.status})`)
      }
      const { artwork } = (await res.json()) as { artwork: { id: string } }
      router.push(`/artworks/${artwork.id}`)
    } catch (err) {
      console.error('Link to artwork failed:', err)
      window.alert(err instanceof Error ? err.message : 'Failed to link to artwork')
    } finally {
      setLoading(false)
    }
  }

  const generateOne = async (params: GenerateParams): Promise<GeneratedImage> => {
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
    const json = (await res.json()) as { image?: GeneratedImage } & GeneratedImage
    return json.image ?? (json as GeneratedImage)
  }

  /**
   * Generate one or more variations of the same prompt sequentially.
   * Sequential to keep Gemini rate-limiting predictable; results
   * stream into the gallery as each one finishes so the operator can
   * see progress.
   */
  /**
   * When the operator leaves the subject blank, derive one from the
   * selected topic's contribution context. Runs once per batch (not per
   * variation) so all variations share the same subject, and the derived
   * value is pushed back into the visible field. Returns null if it can't
   * be resolved (caller aborts the batch).
   */
  const resolveSubject = async (
    params: GenerateParams
  ): Promise<GenerateParams | null> => {
    if (params.prompt?.trim()) return params

    if (!contributionContext.trim()) {
      window.alert(
        'Enter a subject, or pick a topic with approved contributions to auto-derive one.'
      )
      return null
    }

    const artistTagline = params.stylePackId
      ? listLaunchStylePacks().find((p) => p.id === params.stylePackId)?.persona
          .tagline ?? null
      : null

    try {
      const res = await fetch('/api/art-generator/suggest-subject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contributionContext, artistTagline }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Subject derivation failed (${res.status})`)
      }
      const { subject } = (await res.json()) as { subject?: string }
      if (!subject?.trim()) throw new Error('No subject returned')
      setPromptValue(subject)
      return { ...params, prompt: subject }
    } catch (err) {
      console.error('Subject derivation failed:', err)
      window.alert(
        err instanceof Error
          ? `Could not derive a subject: ${err.message}. Type one instead.`
          : 'Could not derive a subject. Type one instead.'
      )
      return null
    }
  }

  const handleGenerate = async (
    params: GenerateParams,
    opts?: { count?: number }
  ) => {
    const count = Math.max(1, Math.min(10, opts?.count ?? 1))
    setLoading(true)
    setBatchProgress(count > 1 ? { done: 0, total: count } : null)
    setRecentBatch([])
    try {
      const resolved = await resolveSubject(params)
      if (!resolved) return

      for (let i = 0; i < count; i++) {
        try {
          const generated = await generateOne(resolved)
          setCurrentImage(generated)
          setImages((prev) => [generated, ...prev])
          setRecentBatch((prev) => [...prev, generated])
        } catch (err) {
          console.error(`Generation ${i + 1}/${count} failed:`, err)
        }
        setBatchProgress((prev) => (prev ? { done: i + 1, total: count } : null))
      }
    } finally {
      setLoading(false)
      setBatchProgress(null)
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

  /**
   * When an edit branches into a brand-new generated_images row (or
   * the operator forks from a history entry), splice the new image
   * into the gallery, focus on it, and exit edit mode so the operator
   * can immediately see the new sibling alongside the original.
   */
  const handleBranchCreated = (created: GeneratedImage) => {
    setImages((prev) => [created, ...prev.filter((img) => img.id !== created.id)])
    setRecentBatch((prev) => [created, ...prev.filter((img) => img.id !== created.id)])
    setCurrentImage(created)
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
          <>
            {editMode && currentImage ? (
              // Edit mode → full-width 3-panel ArtStudio.
              // The prompt builder + generation panel are stowed away;
              // the operator is focused on a single image and its layers.
              <ArtStudio
                image={currentImage}
                onUpdate={handleEditComplete}
                onBranchCreated={handleBranchCreated}
                onClose={() => setEditMode(false)}
              />
            ) : (
              <div className="flex gap-6">
                {/* Left sidebar */}
                <div className="w-[320px] shrink-0 space-y-6">
                  <PromptBuilder
                    onGenerate={handleGenerate}
                    loading={loading}
                    value={promptValue}
                    onChange={setPromptValue}
                    allowEmptySubject={!!contributionContext.trim()}
                  />
                  <TopicContextPicker
                    topics={topics}
                    onContextChange={setContributionContext}
                    onSubjectSuggest={setPromptValue}
                  />
                </div>

                {/* Center panel */}
                <div className="min-w-0 flex-1">
                  <GenerationPanel
                    image={currentImage}
                    loading={loading}
                    recentBatch={recentBatch}
                    batchProgress={batchProgress}
                    onSelectBatchSibling={(img) => setCurrentImage(img)}
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
                    onLinkArtwork={handleLinkArtwork}
                    onDownload={handleDownload}
                    onDelete={() => currentImage && handleDelete(currentImage.id)}
                    onUpdate={(updated) => {
                      setCurrentImage(updated)
                      setImages((prev) => prev.map((img) => (img.id === updated.id ? updated : img)))
                      setRecentBatch((prev) => prev.map((img) => (img.id === updated.id ? updated : img)))
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'gallery' && (
          <ImageGallery
            images={images}
            onSelect={handleGallerySelect}
            onDelete={handleDelete}
            onUpdate={(updated) => {
              setImages((prev) => prev.map((img) => (img.id === updated.id ? updated : img)))
              if (currentImage?.id === updated.id) setCurrentImage(updated)
            }}
          />
        )}
      </div>
    </>
  )
}
