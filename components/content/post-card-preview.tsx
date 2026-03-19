'use client'

import {
  BRAND_TOKENS,
  BACKGROUND_PRESETS,
  getPostFormat,
  getSlides,
  type VisualConfig,
  type SlideConfig,
  type BlockType,
} from '@/lib/constants/content'

const B = BRAND_TOKENS

function resolveBackgroundCss(bg: string): string {
  const preset = BACKGROUND_PRESETS.find(p => p.key === bg)
  return preset ? preset.css : bg
}

function GradText({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{ background: `linear-gradient(135deg, ${B.coral}, ${B.gold})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...style }}>
      {children}
    </span>
  )
}

function renderBlock(block: BlockType, index: number, s: number, isDark: boolean) {
  const fg = isDark ? B.white : B.black
  const fgSub = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(10,10,10,0.6)'

  switch (block.type) {
    case 'tag':
      return (
        <div key={index} style={{ fontSize: 10 * s, fontWeight: 800, letterSpacing: 2.5 * s, color: B.coral, marginBottom: 12 * s, fontFamily: B.displayFont }}>
          {block.text}
        </div>
      )

    case 'headline': {
      const size = block.fontSize === 'sm' ? 22 * s : block.fontSize === 'md' ? 26 * s : 28 * s
      return (
        <div key={index} style={{ fontSize: size, fontWeight: 900, lineHeight: 1.1, color: fg, whiteSpace: 'pre-line', marginBottom: 14 * s, fontFamily: B.displayFont }}>
          {isDark ? <GradText style={{ fontSize: size, fontWeight: 900 }}>{block.text}</GradText> : block.text}
        </div>
      )
    }

    case 'text':
      return (
        <div key={index} style={{ fontSize: 13 * s, lineHeight: 1.55, color: fgSub, whiteSpace: 'pre-line', fontFamily: B.bodyFont }}>
          {block.text}
        </div>
      )

    case 'steps':
      return (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 10 * s }}>
          {block.items.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 * s }}>
              <div style={{ width: 26 * s, height: 26 * s, borderRadius: 8 * s, background: `linear-gradient(135deg, ${B.coral}, ${B.gold})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 * s, fontWeight: 900, color: B.white, flexShrink: 0, fontFamily: B.displayFont }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <span style={{ fontSize: 13 * s, color: fgSub, fontWeight: 500, fontFamily: B.bodyFont }}>{step}</span>
            </div>
          ))}
        </div>
      )

    case 'bullets':
      return (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 8 * s }}>
          {block.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 * s }}>
              <div style={{ width: 6 * s, height: 6 * s, borderRadius: '50%', background: B.coral, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5 * s, color: fgSub, fontWeight: 500, fontFamily: B.bodyFont }}>{item}</span>
            </div>
          ))}
        </div>
      )

    case 'metric':
      return (
        <div key={index} style={{ marginBottom: 8 * s }}>
          <div style={{ fontSize: 32 * s, fontWeight: 900, color: B.coral, lineHeight: 1, fontFamily: B.displayFont }}>{block.value}</div>
          <div style={{ fontSize: 11 * s, color: fgSub, fontWeight: 600, marginTop: 4 * s, textTransform: 'uppercase', letterSpacing: 1.5 * s, fontFamily: B.bodyFont }}>{block.label}</div>
        </div>
      )

    case 'quote':
      return (
        <div key={index} style={{ borderLeft: `3px solid ${B.coral}`, paddingLeft: 12 * s, marginBottom: 8 * s }}>
          <div style={{ fontSize: 13 * s, lineHeight: 1.5, color: fgSub, fontStyle: 'italic', whiteSpace: 'pre-line', fontFamily: B.bodyFont }}>&ldquo;{block.text}&rdquo;</div>
          {block.author && <div style={{ fontSize: 10 * s, color: B.coral, fontWeight: 700, marginTop: 6 * s, fontFamily: B.bodyFont }}>&mdash; {block.author}</div>}
        </div>
      )

    case 'table':
      return (
        <div key={index} style={{ marginBottom: 12 * s, borderRadius: 6 * s, overflow: 'hidden', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 * s }}>
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i} style={{ padding: `${5 * s}px ${8 * s}px`, textAlign: 'left', fontWeight: 700, color: B.coral, borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', fontSize: 9 * s, letterSpacing: 1 * s, textTransform: 'uppercase' as const, fontFamily: B.displayFont }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: `${4 * s}px ${8 * s}px`, color: fgSub, fontWeight: 500, borderBottom: ri < block.rows.length - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}` : 'none', fontFamily: B.bodyFont }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {block.caption && <div style={{ padding: `${4 * s}px ${8 * s}px`, fontSize: 8 * s, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)', fontStyle: 'italic', fontFamily: B.bodyFont }}>{block.caption}</div>}
        </div>
      )

    case 'progress':
      return (
        <div key={index} style={{ marginBottom: 10 * s }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 * s }}>
            <span style={{ fontSize: 11 * s, fontWeight: 600, color: fgSub, fontFamily: B.bodyFont }}>{block.label}</span>
            <span style={{ fontSize: 12 * s, fontWeight: 800, color: B.coral, fontFamily: B.displayFont }}>{block.value}{block.unit || ''} <span style={{ fontWeight: 500, fontSize: 8 * s, color: fgSub }}>current</span> <span style={{ fontWeight: 500, fontSize: 9 * s, color: fgSub }}>&rarr; {block.target}{block.unit || ''}</span> <span style={{ fontWeight: 500, fontSize: 8 * s, color: fgSub }}>target</span></span>
          </div>
          <div style={{ height: 6 * s, borderRadius: 3 * s, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3 * s, background: `linear-gradient(90deg, ${B.coral}, ${B.gold})`, width: `${Math.min(100, (block.value / block.target) * 100)}%`, transition: 'width 0.3s' }} />
          </div>
        </div>
      )

    case 'dashboardCard':
      return (
        <div key={index} style={{ marginBottom: 12 * s, borderRadius: 8 * s, border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, padding: `${10 * s}px ${12 * s}px`, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: 9 * s, fontWeight: 700, color: B.coral, letterSpacing: 1.5 * s, textTransform: 'uppercase' as const, marginBottom: 8 * s, fontFamily: B.displayFont }}>{(block as { title: string }).title}</div>
          <div style={{ display: 'flex', gap: 12 * s }}>
            {(block as { metrics: { value: string; label: string }[] }).metrics.map((m, i) => (
              <div key={i} style={{ flex: 1 }}>
                <div style={{ fontSize: 18 * s, fontWeight: 900, color: isDark ? B.white : B.black, lineHeight: 1.1, fontFamily: B.displayFont }}>{m.value}</div>
                <div style={{ fontSize: 8 * s, fontWeight: 600, color: fgSub, marginTop: 2 * s, textTransform: 'uppercase' as const, letterSpacing: 0.5 * s, fontFamily: B.bodyFont }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      )

    case 'screenshot':
      return (
        <div key={index} style={{ marginBottom: 10 * s }}>
          {block.url ? (
            <img
              src={block.url}
              alt={block.alt || ''}
              style={{ width: '100%', borderRadius: 6 * s, border: block.border ? `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}` : 'none' }}
            />
          ) : (
            <div style={{ width: '100%', height: 80 * s, borderRadius: 6 * s, border: `1px dashed ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 * s, color: fgSub, fontFamily: B.bodyFont }}>
              Image URL required
            </div>
          )}
        </div>
      )

    // Artwork-specific blocks
    case 'artworkShowcase':
      return (
        <div key={index} style={{ marginBottom: 12 * s }}>
          {/* Framed image placeholder */}
          <div style={{
            width: '100%',
            aspectRatio: '4/3',
            borderRadius: 4 * s,
            border: `2px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 10 * s,
            overflow: 'hidden',
            boxShadow: `0 ${4 * s}px ${16 * s}px rgba(0,0,0,0.15)`,
          }}>
            {block.imageUrl ? (
              <img src={block.imageUrl} alt={block.artworkTitle} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ textAlign: 'center', padding: 10 * s }}>
                <div style={{ fontSize: 20 * s, marginBottom: 4 * s, opacity: 0.3 }}>&#x1F5BC;</div>
                <div style={{ fontSize: 9 * s, color: fgSub, fontFamily: B.bodyFont }}>Artwork Image</div>
              </div>
            )}
          </div>
          {block.topicTitle && (
            <div style={{ fontSize: 9 * s, fontWeight: 700, letterSpacing: 2 * s, color: B.coral, marginBottom: 6 * s, textTransform: 'uppercase' as const, fontFamily: B.displayFont }}>
              {block.topicTitle}
            </div>
          )}
          <div style={{ fontSize: 18 * s, fontWeight: 900, color: fg, lineHeight: 1.2, marginBottom: 4 * s, fontFamily: B.displayFont }}>
            {block.artworkTitle}
          </div>
          <div style={{ fontSize: 12 * s, fontWeight: 500, color: fgSub, fontFamily: B.bodyFont }}>
            by {block.artistName}
          </div>
        </div>
      )

    case 'artistCredit':
      return (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 12 * s, marginBottom: 12 * s }}>
          <div style={{
            width: 44 * s,
            height: 44 * s,
            borderRadius: '50%',
            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            border: `2px solid ${B.coral}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}>
            {block.imageUrl ? (
              <img src={block.imageUrl} alt={block.artistName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 16 * s, fontWeight: 800, color: B.coral, fontFamily: B.displayFont }}>
                {block.artistName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14 * s, fontWeight: 800, color: fg, fontFamily: B.displayFont }}>{block.artistName}</div>
            {block.bio && (
              <div style={{ fontSize: 10 * s, color: fgSub, lineHeight: 1.4, marginTop: 2 * s, fontFamily: B.bodyFont }}>
                {block.bio.length > 80 ? block.bio.slice(0, 80) + '...' : block.bio}
              </div>
            )}
          </div>
        </div>
      )

    case 'editionInfo': {
      const pct = block.editionSize > 0 ? Math.round((block.editionSold / block.editionSize) * 100) : 0
      return (
        <div key={index} style={{ marginBottom: 10 * s, padding: `${10 * s}px ${12 * s}px`, borderRadius: 8 * s, border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 * s }}>
            <span style={{ fontSize: 9 * s, fontWeight: 700, letterSpacing: 1.5 * s, color: B.coral, textTransform: 'uppercase' as const, fontFamily: B.displayFont }}>EDITION</span>
            <span style={{ fontSize: 10 * s, fontWeight: 600, color: fgSub, fontFamily: B.bodyFont }}>
              {block.editionSold} / {block.editionSize} sold
            </span>
          </div>
          <div style={{ height: 5 * s, borderRadius: 3 * s, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3 * s, background: `linear-gradient(90deg, ${B.coral}, ${B.gold})`, width: `${Math.min(100, pct)}%`, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 8 * s, color: fgSub, marginTop: 4 * s, textTransform: 'capitalize' as const, fontFamily: B.bodyFont }}>
            Status: {block.status}
          </div>
        </div>
      )
    }

    case 'priceDisplay':
      return (
        <div key={index} style={{ marginBottom: 10 * s, textAlign: 'center' }}>
          {block.price && (
            <div style={{ fontSize: 28 * s, fontWeight: 900, color: fg, lineHeight: 1, marginBottom: 8 * s, fontFamily: B.displayFont }}>
              {block.price}
            </div>
          )}
          <div style={{
            display: 'inline-block',
            padding: `${8 * s}px ${20 * s}px`,
            borderRadius: 6 * s,
            background: `linear-gradient(135deg, ${B.coral}, ${B.gold})`,
            fontSize: 12 * s,
            fontWeight: 800,
            color: B.white,
            letterSpacing: 0.5 * s,
            fontFamily: B.displayFont,
          }}>
            {block.cta || 'Shop Now'}
          </div>
        </div>
      )

    case 'spacer':
      return <div key={index} style={{ height: (block.height || 20) * s }} />

    case 'divider':
      return <div key={index} style={{ height: 1, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', margin: `${8 * s}px 0` }} />

    default:
      return null
  }
}

interface PostCardPreviewProps {
  config: VisualConfig
  size?: number
  /** For carousels: which slide to render (defaults to 0) */
  slideIndex?: number
}

export function PostCardPreview({ config, size = 340, slideIndex = 0 }: PostCardPreviewProps) {
  const slides = getSlides(config)
  const slide = slides[slideIndex] || slides[0]
  const isDark = slide.dark
  const fmt = getPostFormat(slide.format || config.format)
  const h = size * (fmt.height / fmt.width)
  const refRatio = 1350 / 1080
  const fmtRatio = fmt.height / fmt.width
  const s = (size / 340) * Math.min(1, fmtRatio / refRatio)
  const isCover = fmt.category === 'cover'
  const padL = isCover ? size * 0.25 : 28 * s
  const bgCss = resolveBackgroundCss(slide.bg)

  return (
    <div
      style={{
        width: size,
        height: h,
        background: bgCss,
        borderRadius: 0,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: B.displayFont,
        flexShrink: 0,
      }}
    >
      {/* Accent decorations */}
      {slide.accent === 'topBar' && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4 * s, background: `linear-gradient(135deg, ${B.coral}, ${B.gold})` }} />
      )}
      {slide.accent === 'glowBlob' && (
        <>
          <div style={{ position: 'absolute', top: -40 * s, right: -40 * s, width: 180 * s, height: 180 * s, borderRadius: '50%', background: `radial-gradient(circle, rgba(247,45,94,0.18) 0%, transparent 70%)`, filter: `blur(${30 * s}px)` }} />
          <div style={{ position: 'absolute', bottom: -30 * s, left: -30 * s, width: 120 * s, height: 120 * s, borderRadius: '50%', background: `radial-gradient(circle, rgba(246,182,28,0.12) 0%, transparent 70%)`, filter: `blur(${25 * s}px)` }} />
        </>
      )}
      {slide.accent === 'diagonal' && (
        <div style={{ position: 'absolute', top: -60 * s, right: -60 * s, width: 200 * s, height: 200 * s, background: 'rgba(255,255,255,0.08)', transform: 'rotate(45deg)' }} />
      )}
      {slide.accent === 'splitGlow' && (
        <div style={{ position: 'absolute', top: 0, right: 0, width: '50%', height: '100%', background: `radial-gradient(ellipse at 100% 0%, rgba(247,45,94,0.2) 0%, transparent 60%)` }} />
      )}

      {/* Content blocks */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: `${32 * s}px ${28 * s}px ${20 * s}px ${padL}px`, position: 'relative', zIndex: 1 }}>
        {slide.blocks.map((block, i) => renderBlock(block, i, s, isDark))}
      </div>

      {/* Footer */}
      {!isCover && (
        <div style={{ borderTop: `${0.5 * s}px solid`, borderImage: `linear-gradient(135deg, ${B.coral}, ${B.gold}) 1`, padding: `${10 * s}px ${28 * s}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
          <span style={{ fontSize: 10 * s, fontWeight: 700, letterSpacing: 1 * s, color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)', fontFamily: B.bodyFont }}>{slide.footer}</span>
          <span style={{ fontSize: 9 * s, fontWeight: 800, letterSpacing: 0.5 * s, color: B.coral, fontFamily: B.displayFont }}>artinscale.com</span>
        </div>
      )}

      {/* Carousel dot indicators */}
      {slides.length > 1 && (
        <div style={{ position: 'absolute', bottom: isCover ? 6 * s : 44 * s, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 4 * s, zIndex: 2 }}>
          {slides.map((_, i) => (
            <div key={i} style={{ width: 5 * s, height: 5 * s, borderRadius: '50%', background: i === slideIndex ? B.coral : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'), transition: 'background 0.2s' }} />
          ))}
        </div>
      )}
    </div>
  )
}
