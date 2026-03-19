'use client'

/**
 * Remotion Composition for Post/Carousel Video — Reels/TikTok Optimized
 *
 * High-energy animations designed for short-form social video:
 * - Kinetic typography (word-by-word punch-in, scale pops)
 * - Counter animations for metrics
 * - Ken Burns zoom on each scene
 * - Progress bar fill animations
 * - Fast cuts with dynamic transitions (wipe, zoom, slide)
 *
 * Adapted from Dilipod with ArtInScale coral/gold palette and artwork block types.
 */

import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from 'remotion'
import { BRAND_TOKENS, BACKGROUND_PRESETS, getPostFormat, getSlides, type VisualConfig, type SlideConfig, type BlockType } from '@/lib/constants/content'

const B = BRAND_TOKENS

// ============================================
// Transition types for variety between slides
// ============================================

type TransitionType = 'fade' | 'slideLeft' | 'slideUp' | 'zoom' | 'wipe'

const TRANSITIONS: TransitionType[] = ['fade', 'slideLeft', 'slideUp', 'zoom', 'wipe']

function getTransition(slideIndex: number): TransitionType {
  return TRANSITIONS[slideIndex % TRANSITIONS.length]
}

// ============================================
// Animation utilities
// ============================================

/** Staggered spring entrance for blocks */
function blockEntrance(frame: number, fps: number, blockIndex: number, sceneStart: number) {
  const delay = sceneStart + 4 + blockIndex * 4
  const progress = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 160, mass: 0.6 } })
  return progress
}

/** Ken Burns subtle zoom effect on the whole scene */
function kenBurnsZoom(frame: number, sceneStart: number, sceneDuration: number) {
  const t = (frame - sceneStart) / sceneDuration
  return interpolate(t, [0, 1], [1.0, 1.06], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
}

/** Scene transition calculations */
function sceneTransition(frame: number, sceneStart: number, sceneDuration: number, transition: TransitionType) {
  const fadeInEnd = 8
  const fadeOutStart = sceneDuration - 6

  const entryT = interpolate(frame - sceneStart, [0, fadeInEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const exitRaw = interpolate(frame - sceneStart, [fadeOutStart, sceneDuration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const exitT = 1 - exitRaw

  const visible = frame >= sceneStart && frame < sceneStart + sceneDuration

  let entryStyle: React.CSSProperties = {}
  let exitStyle: React.CSSProperties = {}

  switch (transition) {
    case 'slideLeft':
      entryStyle = { transform: `translateX(${interpolate(entryT, [0, 1], [60, 0])}px)`, opacity: entryT }
      exitStyle = { transform: `translateX(${interpolate(exitT, [0, 1], [-60, 0])}px)`, opacity: exitT }
      break
    case 'slideUp':
      entryStyle = { transform: `translateY(${interpolate(entryT, [0, 1], [40, 0])}px)`, opacity: entryT }
      exitStyle = { transform: `translateY(${interpolate(exitT, [0, 1], [-30, 0])}px)`, opacity: exitT }
      break
    case 'zoom':
      entryStyle = { transform: `scale(${interpolate(entryT, [0, 1], [0.85, 1])})`, opacity: entryT }
      exitStyle = { transform: `scale(${interpolate(exitT, [0, 1], [1.15, 1])})`, opacity: exitT }
      break
    case 'wipe':
      entryStyle = {
        clipPath: `inset(0 ${interpolate(entryT, [0, 1], [100, 0])}% 0 0)`,
        opacity: 1,
      }
      exitStyle = { opacity: exitT }
      break
    case 'fade':
    default:
      entryStyle = { opacity: entryT }
      exitStyle = { opacity: exitT }
      break
  }

  const isEntry = (frame - sceneStart) < fadeInEnd
  const isExit = (frame - sceneStart) > fadeOutStart

  return {
    visible,
    contentStyle: {
      ...(isEntry ? entryStyle : isExit ? exitStyle : { opacity: 1 }),
    },
    bgOpacity: isEntry ? interpolate(entryT, [0, 1], [0.6, 1]) : isExit ? interpolate(exitT, [0, 1], [0.6, 1]) : 1,
  }
}

// ============================================
// Kinetic text — word by word punch-in
// ============================================

function KineticText({
  text, frame, fps, startFrame, s, style, wordDelay = 2,
}: {
  text: string; frame: number; fps: number; startFrame: number; s: number
  style: React.CSSProperties; wordDelay?: number
}) {
  const words = text.split(' ')
  return (
    <div style={style}>
      {words.map((word, i) => {
        const delay = startFrame + i * wordDelay
        const progress = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 200, mass: 0.5 } })
        const scale = interpolate(progress, [0, 1], [1.3, 1])
        const opacity = interpolate(progress, [0, 1], [0, 1])

        return (
          <span key={i} style={{
            display: 'inline-block',
            opacity,
            transform: `scale(${scale})`,
            marginRight: 0.3 * s + 'em',
          }}>
            {word}
          </span>
        )
      })}
    </div>
  )
}

// ============================================
// Counter animation for metric values
// ============================================

function AnimatedCounter({
  value, frame, fps, startFrame, s, style,
}: {
  value: string; frame: number; fps: number; startFrame: number; s: number
  style: React.CSSProperties
}) {
  const numMatch = value.match(/^([€$£]?)(\d[\d,.]*)(.*)$/)
  if (!numMatch) {
    const progress = spring({ frame: frame - startFrame, fps, config: { damping: 15, stiffness: 150 } })
    return <span style={{ ...style, opacity: progress }}>{value}</span>
  }

  const [, prefix, numStr, suffix] = numMatch
  const target = parseFloat(numStr.replace(/,/g, ''))
  const hasComma = numStr.includes(',')

  const duration = 20
  const t = interpolate(frame - startFrame, [0, duration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const eased = Easing.out(Easing.cubic)(t)
  const current = Math.round(target * eased)

  const formatted = hasComma ? current.toLocaleString() : String(current)

  const popProgress = spring({ frame: frame - startFrame - duration, fps, config: { damping: 10, stiffness: 200 } })
  const scale = interpolate(popProgress, [0, 1], [1.15, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <span style={{ ...style, display: 'inline-block', transform: `scale(${scale})` }}>
      {prefix}{formatted}{suffix}
    </span>
  )
}

// ============================================
// Background + Accent
// ============================================

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

function AccentOverlay({ accent, s }: { accent: string; s: number }) {
  switch (accent) {
    case 'topBar':
      return <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4 * s, background: `linear-gradient(135deg, ${B.coral}, ${B.gold})`, zIndex: 2 }} />
    case 'glowBlob':
      return (
        <>
          <div style={{ position: 'absolute', top: -40 * s, right: -40 * s, width: 180 * s, height: 180 * s, borderRadius: '50%', background: 'radial-gradient(circle, rgba(247,45,94,0.18) 0%, transparent 70%)', filter: `blur(${30 * s}px)` }} />
          <div style={{ position: 'absolute', bottom: -30 * s, left: -30 * s, width: 120 * s, height: 120 * s, borderRadius: '50%', background: 'radial-gradient(circle, rgba(246,182,28,0.12) 0%, transparent 70%)', filter: `blur(${25 * s}px)` }} />
        </>
      )
    case 'diagonal':
      return <div style={{ position: 'absolute', top: -60 * s, right: -60 * s, width: 200 * s, height: 200 * s, background: 'rgba(255,255,255,0.08)', transform: 'rotate(45deg)' }} />
    case 'splitGlow':
      return <div style={{ position: 'absolute', top: 0, right: 0, width: '50%', height: '100%', background: 'radial-gradient(ellipse at 100% 0%, rgba(247,45,94,0.2) 0%, transparent 60%)' }} />
    default:
      return null
  }
}

// ============================================
// Animated block renderers
// ============================================

function renderAnimatedBlock(
  block: BlockType, index: number, s: number, isDark: boolean,
  frame: number, fps: number, sceneStart: number,
) {
  const fg = isDark ? B.white : B.black
  const fgSub = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.6)'
  const progress = blockEntrance(frame, fps, index, sceneStart)
  const translateY = interpolate(progress, [0, 1], [24, 0])
  const opacity = interpolate(progress, [0, 1], [0, 1])
  const blockStartFrame = sceneStart + 4 + index * 4

  const wrapStyle: React.CSSProperties = {
    opacity,
    transform: `translateY(${translateY}px)`,
  }

  switch (block.type) {
    case 'tag':
      return (
        <div key={index} style={wrapStyle}>
          <div style={{ fontSize: 13 * s, fontWeight: 800, letterSpacing: 3 * s, color: B.coral, marginBottom: 8 * s }}>
            {block.text}
          </div>
        </div>
      )

    case 'headline': {
      const size = block.fontSize === 'sm' ? 24 * s : block.fontSize === 'md' ? 30 * s : 34 * s
      const headlineStyle: React.CSSProperties = { fontSize: size, fontWeight: 900, lineHeight: 1.1, whiteSpace: 'pre-line' as const, marginBottom: 14 * s }
      return (
        <div key={index}>
          {isDark ? (
            <GradText style={headlineStyle}>
              <KineticText
                text={block.text}
                frame={frame}
                fps={fps}
                startFrame={blockStartFrame}
                s={s}
                style={{}}
                wordDelay={2}
              />
            </GradText>
          ) : (
            <KineticText
              text={block.text}
              frame={frame}
              fps={fps}
              startFrame={blockStartFrame}
              s={s}
              style={{ ...headlineStyle, color: fg }}
              wordDelay={2}
            />
          )}
        </div>
      )
    }

    case 'text':
      return (
        <div key={index} style={wrapStyle}>
          <div style={{ fontSize: 15 * s, lineHeight: 1.55, color: fgSub, whiteSpace: 'pre-line' }}>
            {block.text}
          </div>
        </div>
      )

    case 'steps':
      return (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 10 * s }}>
          {block.items.map((step, i) => {
            const stepProgress = blockEntrance(frame, fps, index + i * 0.5, sceneStart)
            const stepY = interpolate(stepProgress, [0, 1], [20, 0])
            const stepOp = interpolate(stepProgress, [0, 1], [0, 1])
            const badgeScale = interpolate(
              spring({ frame: frame - (blockStartFrame + i * 3), fps, config: { damping: 8, stiffness: 250, mass: 0.4 } }),
              [0, 1], [0.5, 1]
            )
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 * s, opacity: stepOp, transform: `translateY(${stepY}px)` }}>
                <div style={{ width: 26 * s, height: 26 * s, borderRadius: 8 * s, background: `linear-gradient(135deg, ${B.coral}, ${B.gold})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 * s, fontWeight: 900, color: B.white, flexShrink: 0, transform: `scale(${badgeScale})` }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
                <span style={{ fontSize: 13 * s, color: fgSub, fontWeight: 500 }}>{step}</span>
              </div>
            )
          })}
        </div>
      )

    case 'bullets':
      return (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 8 * s }}>
          {block.items.map((item, i) => {
            const bulletProgress = blockEntrance(frame, fps, index + i * 0.4, sceneStart)
            const bX = interpolate(bulletProgress, [0, 1], [-30, 0])
            const bOp = interpolate(bulletProgress, [0, 1], [0, 1])
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 * s, opacity: bOp, transform: `translateX(${bX}px)` }}>
                <div style={{ width: 6 * s, height: 6 * s, borderRadius: '50%', background: B.coral, flexShrink: 0 }} />
                <span style={{ fontSize: 15 * s, color: fgSub, fontWeight: 500 }}>{item}</span>
              </div>
            )
          })}
        </div>
      )

    case 'metric': {
      const metricScale = interpolate(
        spring({ frame: frame - blockStartFrame - 5, fps, config: { damping: 8, stiffness: 180, mass: 0.5 } }),
        [0, 1], [0.8, 1]
      )
      return (
        <div key={index} style={{ ...wrapStyle, marginBottom: 8 * s }}>
          <div style={{ transform: `scale(${metricScale})`, transformOrigin: 'left bottom' }}>
            <AnimatedCounter
              value={block.value}
              frame={frame}
              fps={fps}
              startFrame={blockStartFrame}
              s={s}
              style={{ fontSize: 40 * s, fontWeight: 900, color: B.coral, lineHeight: 1, display: 'block' }}
            />
          </div>
          <div style={{ fontSize: 13 * s, color: fgSub, fontWeight: 600, marginTop: 6 * s, textTransform: 'uppercase', letterSpacing: 1.5 * s }}>{block.label}</div>
        </div>
      )
    }

    case 'quote':
      return (
        <div key={index} style={wrapStyle}>
          <div style={{ borderLeft: `3px solid ${B.coral}`, paddingLeft: 12 * s, marginBottom: 8 * s }}>
            <div style={{ fontSize: 13 * s, lineHeight: 1.5, color: fgSub, fontStyle: 'italic', whiteSpace: 'pre-line' }}>&ldquo;{block.text}&rdquo;</div>
            {block.author && <div style={{ fontSize: 10 * s, color: B.coral, fontWeight: 700, marginTop: 6 * s }}>&mdash; {block.author}</div>}
          </div>
        </div>
      )

    case 'table':
      return (
        <div key={index} style={wrapStyle}>
          <div style={{ marginBottom: 12 * s, borderRadius: 6 * s, overflow: 'hidden', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 * s }}>
              <thead>
                <tr>
                  {block.headers.map((h, i) => (
                    <th key={i} style={{ padding: `${5 * s}px ${8 * s}px`, textAlign: 'left', fontWeight: 700, color: B.coral, borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', fontSize: 9 * s, letterSpacing: 1 * s, textTransform: 'uppercase' as const }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{ padding: `${4 * s}px ${8 * s}px`, color: fgSub, fontWeight: 500, borderBottom: ri < block.rows.length - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}` : 'none' }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )

    case 'progress': {
      const fillDuration = 18
      const fillT = interpolate(frame - blockStartFrame, [4, 4 + fillDuration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      const fillEased = Easing.out(Easing.cubic)(fillT)
      const fillWidth = Math.min(100, (block.value / block.target) * 100) * fillEased

      return (
        <div key={index} style={{ ...wrapStyle, marginBottom: 10 * s }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 * s }}>
            <span style={{ fontSize: 11 * s, fontWeight: 600, color: fgSub }}>{block.label}</span>
            <AnimatedCounter
              value={`${block.value}${block.unit || ''}`}
              frame={frame}
              fps={fps}
              startFrame={blockStartFrame}
              s={s}
              style={{ fontSize: 12 * s, fontWeight: 800, color: B.coral }}
            />
          </div>
          <div style={{ height: 6 * s, borderRadius: 3 * s, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3 * s, background: `linear-gradient(90deg, ${B.coral}, ${B.gold})`, width: `${fillWidth}%` }} />
          </div>
        </div>
      )
    }

    case 'dashboardCard': {
      return (
        <div key={index} style={wrapStyle}>
          <div style={{ marginBottom: 12 * s, borderRadius: 8 * s, border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, padding: `${10 * s}px ${12 * s}px`, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
            <div style={{ fontSize: 9 * s, fontWeight: 700, color: B.coral, letterSpacing: 1.5 * s, textTransform: 'uppercase' as const, marginBottom: 8 * s }}>{block.title}</div>
            <div style={{ display: 'flex', gap: 12 * s }}>
              {block.metrics.map((m, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <AnimatedCounter
                    value={m.value}
                    frame={frame}
                    fps={fps}
                    startFrame={blockStartFrame + i * 4}
                    s={s}
                    style={{ fontSize: 18 * s, fontWeight: 900, color: isDark ? B.white : B.black, lineHeight: 1.1, display: 'block' }}
                  />
                  <div style={{ fontSize: 8 * s, fontWeight: 600, color: fgSub, marginTop: 2 * s, textTransform: 'uppercase' as const, letterSpacing: 0.5 * s }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    }

    case 'screenshot':
      return (
        <div key={index} style={wrapStyle}>
          <div style={{ marginBottom: 10 * s }}>
            {block.url ? (
              <img src={block.url} alt={block.alt || ''} style={{ width: '100%', borderRadius: 6 * s, border: block.border ? `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}` : 'none' }} />
            ) : (
              <div style={{ width: '100%', height: 80 * s, borderRadius: 6 * s, border: `1px dashed ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 * s, color: fgSub }}>
                Image URL required
              </div>
            )}
          </div>
        </div>
      )

    // ============================================
    // Artwork-specific animated block types
    // ============================================

    case 'artworkShowcase': {
      const scaleIn = interpolate(
        spring({ frame: frame - blockStartFrame, fps, config: { damping: 14, stiffness: 120, mass: 0.7 } }),
        [0, 1], [0.9, 1]
      )
      return (
        <div key={index} style={{ ...wrapStyle, transform: `translateY(${translateY}px) scale(${scaleIn})` }}>
          <div style={{ marginBottom: 10 * s }}>
            {/* Gallery frame */}
            <div style={{
              width: '100%', height: 80 * s, borderRadius: 4 * s,
              border: `2px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}`,
              background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10 * s, color: fgSub,
            }}>
              {block.artworkTitle || 'Artwork'}
            </div>
            {/* Title + Artist */}
            <div style={{ marginTop: 6 * s }}>
              <div style={{ fontSize: 14 * s, fontWeight: 800, color: fg }}>{block.artworkTitle}</div>
              <div style={{ fontSize: 10 * s, fontWeight: 500, color: B.coral, marginTop: 2 * s }}>{block.artistName}</div>
            </div>
          </div>
        </div>
      )
    }

    case 'artistCredit': {
      return (
        <div key={index} style={wrapStyle}>
          <div style={{ marginBottom: 10 * s }}>
            <div style={{ fontSize: 24 * s, fontWeight: 900, color: isDark ? B.coral : fg, lineHeight: 1.1 }}>{block.artistName}</div>
            {block.bio && (
              <div style={{ fontSize: 12 * s, fontWeight: 500, color: fgSub, marginTop: 4 * s, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{block.bio}</div>
            )}
          </div>
        </div>
      )
    }

    case 'editionInfo': {
      const fillDuration = 18
      const fillT = interpolate(frame - blockStartFrame, [4, 4 + fillDuration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      const fillEased = Easing.out(Easing.cubic)(fillT)
      const pct = block.editionSize > 0 ? Math.min(1, block.editionSold / block.editionSize) : 0
      const fillWidth = pct * 100 * fillEased

      return (
        <div key={index} style={{ ...wrapStyle, marginBottom: 10 * s }}>
          <div style={{ fontSize: 16 * s, fontWeight: 800, color: fg, marginBottom: 4 * s }}>
            Edition {block.editionSold}/{block.editionSize}
          </div>
          <div style={{ height: 4 * s, borderRadius: 2 * s, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden', width: '50%' }}>
            <div style={{ height: '100%', borderRadius: 2 * s, background: `linear-gradient(90deg, ${B.coral}, ${B.gold})`, width: `${fillWidth}%` }} />
          </div>
        </div>
      )
    }

    case 'priceDisplay': {
      const priceScale = interpolate(
        spring({ frame: frame - blockStartFrame - 2, fps, config: { damping: 10, stiffness: 200, mass: 0.5 } }),
        [0, 1], [0.7, 1]
      )
      return (
        <div key={index} style={wrapStyle}>
          <div style={{ marginBottom: 10 * s }}>
            <div style={{ fontSize: 28 * s, fontWeight: 900, color: B.coral, transform: `scale(${priceScale})`, transformOrigin: 'left bottom', display: 'inline-block' }}>
              {block.price || 'Price TBD'}
            </div>
            <div style={{ fontSize: 12 * s, fontWeight: 600, color: fgSub, marginTop: 4 * s }}>{block.cta || 'Shop at artinscale.com'}</div>
          </div>
        </div>
      )
    }

    case 'spacer':
      return <div key={index} style={{ height: (block.height || 20) * s }} />

    case 'divider': {
      const lineProgress = interpolate(
        spring({ frame: frame - blockStartFrame, fps, config: { damping: 20, stiffness: 100 } }),
        [0, 1], [0, 100]
      )
      return (
        <div key={index} style={wrapStyle}>
          <div style={{
            height: 1,
            background: `linear-gradient(90deg, ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} ${lineProgress}%, transparent ${lineProgress}%)`,
            margin: `${8 * s}px 0`,
          }} />
        </div>
      )
    }

    default:
      return null
  }
}

// ============================================
// Single Slide Scene
// ============================================

interface SlideSceneProps {
  slide: SlideConfig
  slideIndex: number
  sceneStart: number
  sceneDuration: number
  width: number
  height: number
  totalSlides: number
}

function SlideScene({ slide, slideIndex, sceneStart, sceneDuration, width, height, totalSlides }: SlideSceneProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const isDark = slide.dark

  const aspect = width / height
  const isTall = aspect < 0.7
  const s = (width / 1080) * (isTall ? 2.4 : 1)
  const bgCss = resolveBackgroundCss(slide.bg)
  const isCover = getPostFormat(slide.format).category === 'cover'
  const padSide = isTall ? 52 * (width / 1080) : 28 * s
  const padL = isCover ? width * 0.12 : padSide
  const padR = padSide

  const transition = getTransition(slideIndex)
  const { visible, contentStyle, bgOpacity } = sceneTransition(frame, sceneStart, sceneDuration, transition)

  if (!visible) return null

  const zoom = kenBurnsZoom(frame, sceneStart, sceneDuration)

  const topPad = isTall ? height * 0.06 : 32 * s
  const bottomPad = isTall ? height * 0.15 : 20 * s

  const slideProgress = interpolate(frame - sceneStart, [0, sceneDuration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const counterEntrance = spring({ frame: frame - sceneStart - 2, fps, config: { damping: 14, stiffness: 160 } })

  return (
    <AbsoluteFill>
      {/* Background layer */}
      <div style={{
        width, height, background: bgCss,
        position: 'absolute', top: 0, left: 0,
        opacity: bgOpacity,
        transform: `scale(${zoom})`,
        transformOrigin: 'center center',
      }}>
        <AccentOverlay accent={slide.accent} s={s} />
      </div>

      {/* Content layer */}
      <div style={{
        width, height,
        position: 'relative', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        fontFamily: B.displayFont,
        transform: `scale(${zoom})`,
        transformOrigin: 'center center',
        ...contentStyle,
      }}>
        {/* Progress bar at top for tall formats */}
        {isTall && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            display: 'flex', gap: 4 * (width / 1080), padding: `${12 * (width / 1080)}px ${16 * (width / 1080)}px`,
          }}>
            {Array.from({ length: totalSlides }).map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 3 * (width / 1080), borderRadius: 2 * (width / 1080),
                background: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 2 * (width / 1080),
                  background: i < slideIndex ? (isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)')
                    : i === slideIndex ? `linear-gradient(90deg, ${B.coral}, ${B.gold})`
                    : 'transparent',
                  width: i < slideIndex ? '100%' : i === slideIndex ? `${slideProgress * 100}%` : '0%',
                  transition: 'none',
                }} />
              </div>
            ))}
          </div>
        )}

        {/* Slide counter badge */}
        {isTall && (
          <div style={{
            position: 'absolute',
            top: 32 * (width / 1080), right: 24 * (width / 1080),
            zIndex: 10,
            opacity: counterEntrance,
            transform: `scale(${interpolate(counterEntrance, [0, 1], [0.7, 1])})`,
          }}>
            <div style={{
              background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
              backdropFilter: 'blur(8px)',
              borderRadius: 20 * (width / 1080),
              padding: `${6 * (width / 1080)}px ${14 * (width / 1080)}px`,
              fontSize: 22 * (width / 1080),
              fontWeight: 800,
              color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)',
              letterSpacing: 1,
            }}>
              {slideIndex + 1}<span style={{ opacity: 0.5 }}>/{totalSlides}</span>
            </div>
          </div>
        )}

        {/* Content blocks */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          justifyContent: 'center',
          padding: `${topPad}px ${padR}px ${bottomPad}px ${padL}px`,
          position: 'relative', zIndex: 1,
          gap: isTall ? 32 * (width / 1080) : 0,
        }}>
          {slide.blocks.map((block, i) =>
            renderAnimatedBlock(block, i, s, isDark, frame, fps, sceneStart)
          )}
        </div>

        {/* Footer */}
        {!isCover && (
          <div style={{
            borderTop: `${0.5 * s}px solid`, borderImage: `linear-gradient(135deg, ${B.coral}, ${B.gold}) 1`,
            padding: `${12 * s}px ${padSide}px`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'relative', zIndex: 1,
          }}>
            <span style={{ fontSize: 11 * s, fontWeight: 700, letterSpacing: 1.2 * s, color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)' }}>{slide.footer}</span>
            <div style={{ width: 24 * s, height: 24 * s, borderRadius: 6 * s, background: `linear-gradient(135deg, ${B.coral}, ${B.gold})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 * s, fontWeight: 900, color: B.white }}>A</div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  )
}

// ============================================
// Main Composition
// ============================================

export interface PostVideoProps {
  config: VisualConfig
  /** Frames per slide (default 75 = 2.5s at 30fps) */
  framesPerSlide?: number
}

export function PostVideoComposition({ config, framesPerSlide = 75 }: PostVideoProps) {
  const slides = getSlides(config)
  const { width, height } = useVideoConfig()

  return (
    <AbsoluteFill style={{ backgroundColor: B.black }}>
      {slides.map((slide, i) => {
        const sceneStart = i * framesPerSlide
        return (
          <SlideScene
            key={i}
            slide={slide}
            slideIndex={i}
            sceneStart={sceneStart}
            sceneDuration={framesPerSlide}
            width={width}
            height={height}
            totalSlides={slides.length}
          />
        )
      })}
    </AbsoluteFill>
  )
}

/**
 * Calculate total duration in frames for a config
 */
export function getVideoDurationInFrames(config: VisualConfig, framesPerSlide = 75): number {
  return getSlides(config).length * framesPerSlide
}
