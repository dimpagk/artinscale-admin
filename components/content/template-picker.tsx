'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SpinnerGap, InstagramLogo, XLogo, Stack } from '@phosphor-icons/react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { type VisualConfig, createDefaultSlide } from '@/lib/constants/content'
import { PostCardPreview } from './post-card-preview'

// ArtInScale content templates — art-focused, branded backgrounds, artwork blocks
const TEMPLATES: { name: string; config: VisualConfig; caption: string }[] = [
  {
    name: 'New Artwork Drop',
    config: {
      bg: 'dramaticDark', dark: true, accent: 'topBar', footer: 'artinscale.com',
      blocks: [
        { type: 'tag', text: 'NEW DROP' },
        { type: 'headline', text: 'Introducing\n"Artwork Name"' },
        { type: 'spacer', height: 8 },
        { type: 'artworkShowcase', artworkTitle: 'Artwork Name', artistName: 'Artist Name', imageUrl: '', topicTitle: '' },
      ],
    },
    caption: 'New drop alert.\n\nIntroducing "Artwork Name" by Artist Name.\n\nNow available exclusively on ArtInScale.\n\n#NewDrop #ArtInScale #ContemporaryArt #ArtCollecting',
  },
  {
    name: 'Artist Spotlight',
    config: {
      bg: 'galleryWhite', dark: false, accent: 'topBar', footer: 'artinscale.com',
      blocks: [
        { type: 'tag', text: 'ARTIST SPOTLIGHT' },
        { type: 'headline', text: 'Meet the Artist\nBehind the Work' },
        { type: 'spacer', height: 6 },
        { type: 'artistCredit', artistName: 'Artist Name', bio: 'Brief artist bio and creative philosophy.', imageUrl: '' },
        { type: 'spacer', height: 6 },
        { type: 'text', text: '"Art is not what you see,\nbut what you make others see."' },
      ],
    },
    caption: 'Artist Spotlight: Artist Name\n\nGet to know the creative mind behind some of our most stunning works.\n\nDiscover their collection at artinscale.com\n\n#ArtistSpotlight #ArtInScale #EmergingArtist #ArtWorld',
  },
  {
    name: 'Exhibition Announcement',
    config: {
      bg: 'deepBlack', dark: true, accent: 'glowBlob', footer: 'artinscale.com',
      blocks: [
        { type: 'tag', text: 'EXHIBITION' },
        { type: 'headline', text: 'Exhibition Title\nComing Soon' },
        { type: 'spacer', height: 8 },
        { type: 'text', text: 'A curated exploration of form,\ncolor, and meaning.' },
        { type: 'spacer', height: 6 },
        { type: 'steps', items: ['Opening: Date TBD', 'Location: Gallery Name', 'RSVP at artinscale.com'] },
      ],
    },
    caption: 'Exhibition Announcement\n\nJoin us for an exclusive showing of works that push boundaries and challenge perspective.\n\nDates and RSVP details coming soon.\n\n#Exhibition #ArtInScale #ArtExhibition #GalleryOpening',
  },
  {
    name: 'Collection Showcase',
    config: {
      bg: 'dramaticDark', dark: true, accent: 'topBar', footer: 'artinscale.com',
      blocks: [],
      slides: [
        {
          bg: 'dramaticDark', dark: true, accent: 'topBar', footer: 'artinscale.com',
          blocks: [
            { type: 'tag', text: 'COLLECTION' },
            { type: 'headline', text: 'The Collection\nTitle' },
            { type: 'spacer', height: 8 },
            { type: 'text', text: 'A curated series of works exploring\na shared visual language.' },
          ],
        },
        {
          bg: 'deepBlack', dark: true, accent: 'none', footer: 'artinscale.com',
          blocks: [
            { type: 'artworkShowcase', artworkTitle: 'Artwork One', artistName: 'Artist Name', imageUrl: '', topicTitle: '' },
          ],
        },
        {
          bg: 'galleryWhite', dark: false, accent: 'none', footer: 'artinscale.com',
          blocks: [
            { type: 'artworkShowcase', artworkTitle: 'Artwork Two', artistName: 'Artist Name', imageUrl: '', topicTitle: '' },
          ],
        },
        {
          bg: 'coralGlow', dark: true, accent: 'none', footer: 'artinscale.com',
          blocks: [
            { type: 'artworkShowcase', artworkTitle: 'Artwork Three', artistName: 'Artist Name', imageUrl: '', topicTitle: '' },
          ],
        },
      ],
    },
    caption: 'The Collection Title\n\nSwipe through a curated selection from this powerful collection.\n\nEach piece tells a story. Together, they speak volumes.\n\nExplore the full collection at artinscale.com\n\n#ArtCollection #ArtInScale #CuratedArt #ContemporaryArt',
  },
  {
    name: 'Behind the Art',
    config: {
      bg: 'warmCream', dark: false, accent: 'none', footer: 'artinscale.com',
      blocks: [
        { type: 'tag', text: 'BEHIND THE ART' },
        { type: 'headline', text: 'The Story\nBehind the Work' },
        { type: 'spacer', height: 8 },
        { type: 'text', text: 'Every artwork carries a story.\nThis one began with a question\nabout light and memory.' },
        { type: 'spacer', height: 6 },
        { type: 'quote', text: 'I wanted to capture a feeling\nyou can\'t put into words.', author: 'Artist Name' },
      ],
    },
    caption: 'Behind the Art\n\nEvery piece has a story. Learn what inspired the creation of this work and the artist\'s journey behind it.\n\nRead more at artinscale.com\n\n#BehindTheArt #ArtInScale #ArtistStory #CreativeProcess',
  },
  {
    name: 'Edition Alert',
    config: {
      bg: 'coralGlow', dark: true, accent: 'splitGlow', footer: 'artinscale.com',
      blocks: [
        { type: 'tag', text: 'LIMITED EDITION' },
        { type: 'headline', text: 'Limited Edition\nNow Available' },
        { type: 'spacer', height: 8 },
        { type: 'editionInfo', editionSize: 50, editionSold: 0, status: 'available' },
        { type: 'spacer', height: 6 },
        { type: 'priceDisplay', price: '', cta: 'Shop at artinscale.com', shopifyHandle: '' },
      ],
    },
    caption: 'Limited Edition Alert\n\nOnly 50 editions available. Once they\'re gone, they\'re gone.\n\nSecure yours now at artinscale.com\n\n#LimitedEdition #ArtInScale #ArtCollecting #EditionDrop',
  },
]

interface TemplatePickerProps {
  open: boolean
  onClose: () => void
}

export function TemplatePicker({ open, onClose }: TemplatePickerProps) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<'instagram' | 'twitter'>('instagram')

  const createFromTemplate = async (template: typeof TEMPLATES[number] | null, postType: 'single' | 'carousel' = 'single') => {
    setCreating(true)
    try {
      let body
      if (template) {
        const isCarousel = template.config.slides && template.config.slides.length > 0
        body = { title: template.name, visual_config: template.config, caption: template.caption, platform: selectedPlatform, post_type: isCarousel ? 'carousel' : 'single' }
      } else if (postType === 'carousel') {
        const slide1 = createDefaultSlide()
        const slide2 = createDefaultSlide({ blocks: [{ type: 'tag', text: 'SLIDE 2' }, { type: 'headline', text: 'Second Slide', fontSize: 'lg' }] })
        body = {
          title: 'Untitled Carousel',
          visual_config: { bg: slide1.bg, dark: slide1.dark, accent: slide1.accent, footer: slide1.footer, blocks: [], slides: [slide1, slide2] },
          platform: selectedPlatform,
          post_type: 'carousel',
        }
      } else {
        body = {
          title: 'Untitled Post',
          visual_config: { bg: 'deepBlack', dark: true, accent: 'topBar', footer: 'artinscale.com', blocks: [{ type: 'tag', text: 'LABEL' }, { type: 'headline', text: 'Your Headline Here' }] },
          platform: selectedPlatform,
        }
      }

      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        const { post } = await res.json()
        onClose()
        router.push(`/content/${post.id}`)
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="Choose a Template" size="lg">
      {/* Platform selector */}
      <div className="flex items-center gap-1 mb-4">
        <Button
          variant={selectedPlatform === 'instagram' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setSelectedPlatform('instagram')}
          icon={<InstagramLogo size={12} weight="bold" />}
          className="h-7 text-[10px] px-2.5"
        >
          Instagram
        </Button>
        <Button
          variant={selectedPlatform === 'twitter' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setSelectedPlatform('twitter')}
          icon={<XLogo size={12} weight="bold" />}
          className="h-7 text-[10px] px-2.5"
        >
          X / Twitter
        </Button>
      </div>

      {creating && (
        <div className="flex items-center justify-center py-12">
          <SpinnerGap size={24} className="animate-spin text-[#F72D5E]" />
        </div>
      )}

      {!creating && (
        <div>
          {/* Blank post options */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <button
              onClick={() => createFromTemplate(null)}
              className="aspect-square border border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-[#F72D5E] hover:border-[#F72D5E]/30 transition-colors"
            >
              <span className="text-2xl">+</span>
              <span className="text-xs font-medium">Blank Post</span>
            </button>
            <button
              onClick={() => createFromTemplate(null, 'carousel')}
              className="aspect-square border border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-[#F72D5E] hover:border-[#F72D5E]/30 transition-colors"
            >
              <Stack size={24} />
              <span className="text-xs font-medium">Blank Carousel</span>
            </button>
          </div>

          {/* Templates */}
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Templates</p>
          <div className="grid grid-cols-3 gap-3">
            {TEMPLATES.map((t, i) => {
              const isCarousel = t.config.slides && t.config.slides.length > 0
              return (
                <button
                  key={i}
                  onClick={() => createFromTemplate(t)}
                  className="rounded-xl overflow-hidden border border-gray-200 hover:border-[#F72D5E]/40 hover:shadow-lg transition-all text-left"
                >
                  <div className="aspect-square overflow-hidden relative">
                    <PostCardPreview config={t.config} size={220} />
                    {isCarousel && (
                      <div className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-sm text-white text-[8px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                        <Stack size={8} weight="bold" />
                        {t.config.slides!.length}
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium truncate">{t.name}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
