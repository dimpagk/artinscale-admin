'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FloppyDisk, DownloadSimple, CalendarBlank, Trash, CheckCircle, ArrowCounterClockwise, Plus, Copy, CaretLeft, CaretRight, Stack, FilmStrip, LinkSimple, Image as ImageIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SOCIAL_POST_STATUSES, getPostFormat, getSlides, createDefaultSlide, type SocialPost, type VisualConfig, type SlideConfig } from '@/lib/constants/content'
import { PostCardPreview } from '@/components/content/post-card-preview'
import { PostEditor } from '@/components/content/post-editor'
import { CaptionEditor } from '@/components/content/caption-editor'
import { ArtworkPicker, type ArtworkWithArtist } from '@/components/content/artwork-picker'
import { downloadPostAsPng, downloadCarouselAsPngs } from '@/components/content/post-canvas-export'
import { VideoPreviewDialog } from '@/components/content/video/video-preview-dialog'
import { ContentCopilotPanel } from '@/components/content/content-copilot-panel'
import { Robot, Sparkle } from '@phosphor-icons/react'
import { AiArtModal } from '@/components/art-generator/ai-art-modal'

interface LinkedArtwork {
  id: string
  title: string | null
  artist_name: string | null
  primary_image_url: string | null
  editions_total: number | null
  editions_sold: number | null
  price: string | null
}

interface PostEditorClientProps {
  post: SocialPost
  linkedArtwork?: LinkedArtwork | null
}

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning'> = {
  draft: 'default',
  scheduled: 'warning',
  published: 'success',
}

export function PostEditorClient({ post: initialPost, linkedArtwork: initialArtwork }: PostEditorClientProps) {
  const router = useRouter()
  const [post, setPost] = useState(initialPost)
  const [config, setConfig] = useState<VisualConfig>(initialPost.visual_config)
  const [caption, setCaption] = useState(initialPost.caption || '')
  const [title, setTitle] = useState(initialPost.title || '')
  const [saving, setSaving] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(initialPost.scheduled_for?.slice(0, 16) || '')
  const [activeSlide, setActiveSlide] = useState(0)
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)
  const [artworkPickerOpen, setArtworkPickerOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [aiArtOpen, setAiArtOpen] = useState(false)
  const [linkedArtwork, setLinkedArtwork] = useState<LinkedArtwork | null>(initialArtwork ?? null)

  const isCarousel = post.post_type === 'carousel'
  const slides = getSlides(config)
  const currentSlide = slides[activeSlide] || slides[0]

  const isDirty =
    JSON.stringify(config) !== JSON.stringify(post.visual_config) ||
    caption !== (post.caption || '') ||
    title !== (post.title || '')

  // Carousel helpers
  const updateSlide = (slideIndex: number, updated: SlideConfig) => {
    if (!isCarousel) {
      setConfig({ ...config, ...updated })
      return
    }
    const next = [...slides]
    next[slideIndex] = updated
    setConfig({ ...config, slides: next })
  }

  const addSlide = () => {
    const base = slides[slides.length - 1] || currentSlide
    const newSlide = createDefaultSlide({ bg: base.bg, dark: base.dark, accent: base.accent, footer: base.footer, format: base.format })
    const next = [...slides, newSlide]
    setConfig({ ...config, slides: next })
    setActiveSlide(next.length - 1)
  }

  const duplicateSlide = (index: number) => {
    const next = [...slides]
    next.splice(index + 1, 0, JSON.parse(JSON.stringify(slides[index])))
    setConfig({ ...config, slides: next })
    setActiveSlide(index + 1)
  }

  const removeSlide = (index: number) => {
    if (slides.length <= 1) return
    const next = slides.filter((_, i) => i !== index)
    setConfig({ ...config, slides: next })
    setActiveSlide(Math.min(activeSlide, next.length - 1))
  }

  const moveSlide = (from: number, direction: -1 | 1) => {
    const to = from + direction
    if (to < 0 || to >= slides.length) return
    const next = [...slides]
    ;[next[from], next[to]] = [next[to], next[from]]
    setConfig({ ...config, slides: next })
    setActiveSlide(to)
  }

  const convertToCarousel = () => {
    const { slides: _, ...single } = config
    setConfig({ ...config, slides: [single, createDefaultSlide({ bg: single.bg, dark: single.dark, accent: single.accent, footer: single.footer, format: single.format })] })
    setPost(prev => ({ ...prev, post_type: 'carousel' }))
    setActiveSlide(0)
  }

  // Use refs so callbacks always have latest state values
  const titleRef = useRef(title)
  titleRef.current = title
  const configRef = useRef(config)
  configRef.current = config
  const captionRef = useRef(caption)
  captionRef.current = caption

  const save = useCallback(async (extraFields?: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/content/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleRef.current,
          visual_config: configRef.current,
          caption: captionRef.current,
          post_type: isCarousel ? 'carousel' : post.post_type,
          ...extraFields,
        }),
      })
      if (res.ok) {
        const { post: updated } = await res.json()
        setPost(updated)
      }
    } finally {
      setSaving(false)
    }
  }, [post.id, post.post_type, isCarousel])

  const handleSchedule = async () => {
    if (!scheduleDate) return
    await save({ scheduled_for: new Date(scheduleDate).toISOString(), status: 'scheduled' })
  }

  const handlePublish = async () => {
    await save({ status: 'published' })
  }

  const handleUnpublish = async () => {
    await save({ status: post.scheduled_for ? 'scheduled' : 'draft' })
  }

  const handleDelete = async () => {
    const res = await fetch(`/api/content/${post.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/content')
  }

  const handleDownload = async () => {
    const slug = title?.replace(/[^a-z0-9]/gi, '-').toLowerCase() || post.id
    if (isCarousel && slides.length > 1) {
      await downloadCarouselAsPngs(config, `artinscale-${slug}`)
    } else {
      await downloadPostAsPng(config, `artinscale-${slug}.png`)
    }
  }

  const handleArtworkSelect = useCallback(async (artwork: ArtworkWithArtist) => {
    setLinkedArtwork({
      id: artwork.id,
      title: artwork.title,
      artist_name: artwork.artistName,
      primary_image_url: artwork.imageUrl || null,
      editions_total: artwork.editionSize,
      editions_sold: artwork.editionSold,
      price: null,
    })
    setArtworkPickerOpen(false)
    // Save artwork_id immediately
    await save({ artwork_id: artwork.id })
  }, [save])

  const handleArtworkUnlink = useCallback(async () => {
    setLinkedArtwork(null)
    await save({ artwork_id: null })
  }, [save])

  return (
    <div className="-m-6 h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/content')}
            >
              <ArrowLeft size={16} />
            </Button>
            <input
              className="bg-transparent text-sm font-semibold border-none outline-none placeholder:text-gray-400 min-w-0"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Untitled Post"
            />
            <Badge variant={STATUS_BADGE_VARIANT[post.status] || 'default'} size="sm">
              {SOCIAL_POST_STATUSES[post.status]?.label}
            </Badge>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Inline schedule */}
            <div className="hidden lg:flex items-center gap-1.5 mr-2 pr-3 border-r border-gray-200">
              <input
                type="datetime-local"
                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30 w-[160px]"
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSchedule}
                disabled={!scheduleDate || saving}
                icon={<CalendarBlank size={12} />}
              >
                Schedule
              </Button>
            </div>

            {/* Status toggle */}
            {post.status === 'published' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnpublish}
                disabled={saving}
                icon={<ArrowCounterClockwise size={12} />}
              >
                Unpublish
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={handlePublish}
                disabled={saving}
                icon={<CheckCircle size={12} weight="bold" />}
              >
                Publish
              </Button>
            )}

            {!isCarousel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={convertToCarousel}
                icon={<Stack size={14} />}
              >
                Carousel
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setVideoDialogOpen(true)} icon={<FilmStrip size={16} />}>
              Video
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCopilotOpen(!copilotOpen)} icon={<Robot size={16} />}>
              AI
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAiArtOpen(true)} icon={<Sparkle size={16} />}>
              Art AI
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownload} icon={<DownloadSimple size={16} />}>
              {isCarousel ? 'PNGs' : 'PNG'}
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete} icon={<Trash size={16} />}>
              Delete
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => save()}
              disabled={saving || !isDirty}
              loading={saving}
              icon={!saving ? <FloppyDisk size={14} /> : undefined}
            >
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Editor controls */}
        <div className="w-[320px] shrink-0 border-r border-gray-200 p-5 overflow-y-auto bg-gray-50/50">
          {/* Artwork link section */}
          <div className="mb-5 pb-5 border-b border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                Linked Artwork
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setArtworkPickerOpen(true)}
                icon={<LinkSimple size={12} weight="bold" />}
              >
                {linkedArtwork ? 'Change' : 'Link'}
              </Button>
            </div>
            {linkedArtwork ? (
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <div className="flex items-center gap-3">
                  {linkedArtwork.primary_image_url ? (
                    <img
                      src={linkedArtwork.primary_image_url}
                      alt={linkedArtwork.title || ''}
                      className="w-10 h-10 rounded object-cover border border-gray-100"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center">
                      <ImageIcon size={16} className="text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 truncate">{linkedArtwork.title || 'Untitled'}</p>
                    <p className="text-[10px] text-gray-500 truncate">{linkedArtwork.artist_name || 'Unknown artist'}</p>
                  </div>
                  <button
                    onClick={handleArtworkUnlink}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    title="Unlink artwork"
                  >
                    <Trash size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-gray-400">No artwork linked. Link one to auto-populate blocks.</p>
            )}
          </div>

          {/* Carousel slide tabs */}
          {isCarousel && (
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                  Slides ({slides.length})
                </p>
                <Button variant="ghost" size="sm" onClick={addSlide} icon={<Plus size={12} weight="bold" />}>
                  Add
                </Button>
              </div>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveSlide(i)}
                    className={`relative group/tab shrink-0 w-12 h-12 rounded-lg border text-[10px] font-bold transition-all ${
                      activeSlide === i
                        ? 'border-[#F72D5E] bg-[#F72D5E]/10 text-[#F72D5E] shadow-[0_0_8px_rgba(247,45,94,0.15)]'
                        : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                    }`}
                  >
                    {i + 1}
                    {slides.length > 1 && (
                      <div className="absolute -top-1 -right-1 opacity-0 group-hover/tab:opacity-100 transition-opacity flex gap-0.5">
                        <button
                          className="w-3.5 h-3.5 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-[#F72D5E] flex items-center justify-center"
                          onClick={e => { e.stopPropagation(); duplicateSlide(i) }}
                          title="Duplicate"
                        ><Copy size={7} /></button>
                        <button
                          className="w-3.5 h-3.5 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-red-400 flex items-center justify-center"
                          onClick={e => { e.stopPropagation(); removeSlide(i) }}
                          title="Remove"
                        ><Trash size={7} /></button>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              {slides.length > 1 && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => moveSlide(activeSlide, -1)} disabled={activeSlide === 0}>
                    <CaretLeft size={10} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => moveSlide(activeSlide, 1)} disabled={activeSlide === slides.length - 1}>
                    <CaretRight size={10} />
                  </Button>
                  <span className="text-[9px] text-gray-400 self-center ml-1">Reorder slide {activeSlide + 1}</span>
                </div>
              )}
            </div>
          )}

          <PostEditor
            config={isCarousel ? currentSlide : config}
            onChange={updated => {
              if (isCarousel) {
                updateSlide(activeSlide, updated)
              } else {
                setConfig({ ...config, ...updated })
              }
            }}
          />

          {/* Mobile-only schedule (hidden on lg+) */}
          <div className="lg:hidden mt-5 pt-5 border-t border-gray-200 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Schedule</p>
            <div className="flex gap-1.5">
              <input
                type="datetime-local"
                className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSchedule}
                disabled={!scheduleDate || saving}
                icon={<CalendarBlank size={12} />}
              >
                Schedule
              </Button>
            </div>
          </div>
        </div>

        {/* Center: Preview + Caption (stacked) */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-lg mx-auto space-y-5">
            <div className="relative rounded-xl overflow-hidden border border-gray-200 shadow-sm">
              <PostCardPreview
                config={config}
                slideIndex={activeSlide}
                size={Math.min(480, 600 * (getPostFormat(currentSlide.format || config.format).width / getPostFormat(currentSlide.format || config.format).height))}
              />
              {/* Carousel slide navigation arrows on preview */}
              {isCarousel && slides.length > 1 && (
                <>
                  <button
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors disabled:opacity-30"
                    onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
                    disabled={activeSlide === 0}
                  >
                    <CaretLeft size={14} weight="bold" />
                  </button>
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors disabled:opacity-30"
                    onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))}
                    disabled={activeSlide === slides.length - 1}
                  >
                    <CaretRight size={14} weight="bold" />
                  </button>
                  <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {activeSlide + 1} / {slides.length}
                  </div>
                </>
              )}
            </div>
            <CaptionEditor caption={caption} onChange={setCaption} />
          </div>
        </div>

        {/* Right: AI Copilot panel */}
        {copilotOpen && (
          <div className="w-[360px] shrink-0">
            <ContentCopilotPanel
              postId={post.id}
              open={copilotOpen}
              onClose={() => setCopilotOpen(false)}
              onPostUpdated={async () => {
                const res = await fetch(`/api/content/${post.id}`)
                if (res.ok) {
                  const { post: updated } = await res.json()
                  setPost(updated)
                  setConfig(updated.visual_config)
                  setCaption(updated.caption || '')
                  setTitle(updated.title || '')
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Artwork picker modal */}
      {artworkPickerOpen && (
        <ArtworkPicker
          open={artworkPickerOpen}
          onClose={() => setArtworkPickerOpen(false)}
          onSelect={handleArtworkSelect}
        />
      )}

      {/* Video export dialog */}
      <VideoPreviewDialog
        config={config}
        open={videoDialogOpen}
        onClose={() => setVideoDialogOpen(false)}
        postTitle={title}
      />

      {/* AI Art generator modal */}
      <AiArtModal
        open={aiArtOpen}
        onClose={() => setAiArtOpen(false)}
        onSelect={(imageUrl) => {
          // Set the image URL on the current slide's artworkShowcase block, or add one
          const updatedBlocks = [...currentSlide.blocks]
          const showcaseIdx = updatedBlocks.findIndex(b => b.type === 'artworkShowcase')
          if (showcaseIdx >= 0) {
            updatedBlocks[showcaseIdx] = { ...updatedBlocks[showcaseIdx], imageUrl } as typeof updatedBlocks[number]
          } else {
            updatedBlocks.push({
              type: 'artworkShowcase',
              artworkTitle: title || 'AI Generated',
              artistName: '',
              imageUrl,
              topicTitle: '',
            })
          }
          updateSlide(activeSlide, { ...currentSlide, blocks: updatedBlocks })
          setAiArtOpen(false)
        }}
      />
    </div>
  )
}
