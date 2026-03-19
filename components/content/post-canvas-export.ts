/**
 * Canvas-based PNG export for social media posts.
 * Renders the post to a canvas at the format's native resolution and triggers download.
 * Supports multiple formats (square, portrait, landscape, story, covers).
 *
 * Adapted from Dilipod with ArtInScale brand tokens, artwork block types,
 * and coral/gold color palette.
 */

import { BRAND_TOKENS, getPostFormat, getSlides, type VisualConfig, type SlideConfig, type BlockType } from '@/lib/constants/content'

const B = BRAND_TOKENS

/**
 * Resolve the actual font family from the CSS variable set by next/font.
 * next/font registers fonts with hashed names (e.g. __Outfit_abc123),
 * so "Outfit" alone won't work in canvas context.
 */
function getResolvedFontFamily(): string {
  if (typeof document === 'undefined') return B.displayFont
  const val = getComputedStyle(document.documentElement).getPropertyValue('--font-outfit').trim()
  return val ? `${val},system-ui,sans-serif` : B.displayFont
}

function drawBackground(ctx: CanvasRenderingContext2D, config: VisualConfig, W: number, H: number) {
  const bgKey = config.bg

  if (bgKey === 'galleryWhite') {
    const grd = ctx.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.3, H * 0.2, H * 0.9)
    grd.addColorStop(0, '#F5F5F5')
    grd.addColorStop(0.5, '#FAFAFA')
    grd.addColorStop(1, '#FFFFFF')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, W, H)
  } else if (bgKey === 'warmCream') {
    const grd = ctx.createLinearGradient(0, 0, W, H)
    grd.addColorStop(0, '#FEF7E6')
    grd.addColorStop(1, '#FDF2F5')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, W, H)
  } else if (bgKey === 'deepBlack') {
    ctx.fillStyle = B.black
    ctx.fillRect(0, 0, W, H)
    const grd1 = ctx.createRadialGradient(W * 0.8, H * 0.15, 0, W * 0.8, H * 0.15, W * 0.35)
    grd1.addColorStop(0, 'rgba(12,16,61,0.18)')
    grd1.addColorStop(1, 'transparent')
    ctx.fillStyle = grd1
    ctx.fillRect(0, 0, W, H)
    const grd2 = ctx.createRadialGradient(W * 0.15, H * 0.85, 0, W * 0.15, H * 0.85, W * 0.25)
    grd2.addColorStop(0, 'rgba(12,16,61,0.12)')
    grd2.addColorStop(1, 'transparent')
    ctx.fillStyle = grd2
    ctx.fillRect(0, 0, W, H)
  } else if (bgKey === 'dramaticDark') {
    ctx.fillStyle = B.black
    ctx.fillRect(0, 0, W, H)
    const grd1 = ctx.createRadialGradient(W * 0.7, H * 0.2, 0, W * 0.7, H * 0.2, W * 0.4)
    grd1.addColorStop(0, 'rgba(247,45,94,0.15)')
    grd1.addColorStop(1, 'transparent')
    ctx.fillStyle = grd1
    ctx.fillRect(0, 0, W, H)
    const grd2 = ctx.createRadialGradient(W * 0.2, H * 0.8, 0, W * 0.2, H * 0.8, W * 0.3)
    grd2.addColorStop(0, 'rgba(246,182,28,0.1)')
    grd2.addColorStop(1, 'transparent')
    ctx.fillStyle = grd2
    ctx.fillRect(0, 0, W, H)
  } else if (bgKey === 'coralGlow') {
    ctx.fillStyle = B.black
    ctx.fillRect(0, 0, W, H)
    const grd = ctx.createRadialGradient(W * 0.9, H * 0.1, 0, W * 0.9, H * 0.1, W * 0.5)
    grd.addColorStop(0, 'rgba(247,45,94,0.25)')
    grd.addColorStop(1, 'transparent')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, W, H)
  } else {
    ctx.fillStyle = config.dark ? B.black : '#FFFFFF'
    ctx.fillRect(0, 0, W, H)
  }
}

function drawAccent(ctx: CanvasRenderingContext2D, accent: string, s: number, W: number, H: number) {
  if (accent === 'topBar') {
    const grd = ctx.createLinearGradient(0, 0, W, 0)
    grd.addColorStop(0, B.coral)
    grd.addColorStop(1, B.gold)
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, W, 4 * s)
  }
  if (accent === 'glowBlob') {
    const grd1 = ctx.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, W * 0.3)
    grd1.addColorStop(0, 'rgba(247,45,94,0.18)')
    grd1.addColorStop(1, 'transparent')
    ctx.fillStyle = grd1
    ctx.fillRect(0, 0, W, H)
    const grd2 = ctx.createRadialGradient(W * 0.1, H * 0.92, 0, W * 0.1, H * 0.92, W * 0.2)
    grd2.addColorStop(0, 'rgba(246,182,28,0.12)')
    grd2.addColorStop(1, 'transparent')
    ctx.fillStyle = grd2
    ctx.fillRect(0, 0, W, H)
  }
  if (accent === 'diagonal') {
    ctx.save()
    ctx.translate(W - 60 * s, -60 * s)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, 0, 200 * s, 200 * s)
    ctx.restore()
  }
  if (accent === 'splitGlow') {
    const grd = ctx.createRadialGradient(W, 0, 0, W, 0, W * 0.6)
    grd.addColorStop(0, 'rgba(247,45,94,0.2)')
    grd.addColorStop(1, 'transparent')
    ctx.fillStyle = grd
    ctx.fillRect(W / 2, 0, W / 2, H)
  }
}

/**
 * Word-wrap text to fit within maxWidth.
 * Splits on explicit \n first, then wraps at word boundaries.
 * ctx.font must be set before calling.
 */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = []
  for (const explicit of text.split('\n')) {
    if (!explicit) { result.push(''); continue }
    const words = explicit.split(' ')
    let current = ''
    for (const word of words) {
      const test = current ? `${current} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && current) {
        result.push(current)
        current = word
      } else {
        current = test
      }
    }
    if (current) result.push(current)
  }
  return result
}

/**
 * Measure total height of all blocks for vertical centering.
 * Heights match the CSS preview component's box model (top baseline).
 * Uses ctx.measureText for accurate word-wrap measurement.
 */
function measureBlocksHeight(ctx: CanvasRenderingContext2D, blocks: BlockType[], s: number, fontFamily: string, W: number, padLeft?: number): number {
  const font = (w: number, sz: number) => `${w} ${sz}px ${fontFamily}`
  const x = padLeft ?? 28 * s
  const maxW = W - x - 28 * s
  let h = 0

  for (const block of blocks) {
    switch (block.type) {
      case 'tag':
        h += 10 * s + 12 * s
        break
      case 'headline': {
        const sz = block.fontSize === 'sm' ? 22 * s : block.fontSize === 'md' ? 26 * s : 28 * s
        ctx.font = font(900, sz)
        const lines = wrapLines(ctx, block.text, maxW)
        h += lines.length * sz * 1.1 + 14 * s
        break
      }
      case 'text': {
        ctx.font = font(500, 13 * s)
        const lines = wrapLines(ctx, block.text, maxW)
        h += lines.length * 13 * s * 1.55
        break
      }
      case 'steps':
        h += block.items.length * 26 * s + Math.max(0, block.items.length - 1) * 10 * s
        break
      case 'bullets':
        h += block.items.length * 15 * s + Math.max(0, block.items.length - 1) * 8 * s
        break
      case 'metric':
        h += 32 * s + 4 * s + 11 * s + 8 * s
        break
      case 'quote': {
        ctx.font = `italic 500 ${13 * s}px ${fontFamily}`
        const lines = wrapLines(ctx, `"${block.text}"`, maxW - 12 * s)
        h += lines.length * 13 * s * 1.5
        if (block.author) h += 6 * s + 10 * s
        h += 8 * s
        break
      }
      case 'table': {
        const headerH = 18 * s
        const rowH = 16 * s
        h += headerH + block.rows.length * rowH + 12 * s
        if (block.caption) h += 12 * s
        break
      }
      case 'progress':
        h += 11 * s + 4 * s + 6 * s + 10 * s
        break
      case 'dashboardCard':
        h += 55 * s + 12 * s
        break
      case 'screenshot':
        h += 80 * s + 10 * s
        break
      case 'artworkShowcase':
        h += 100 * s + 10 * s
        break
      case 'artistCredit':
        h += 24 * s + 14 * s + 10 * s
        break
      case 'editionInfo':
        h += 20 * s + 10 * s
        break
      case 'priceDisplay':
        h += 28 * s + 14 * s + 10 * s
        break
      case 'spacer':
        h += (block.height || 20) * s
        break
      case 'divider':
        h += 16 * s
        break
    }
  }
  return h
}

/**
 * Draw content blocks onto canvas.
 * Uses textBaseline='top' to match CSS box model positioning.
 */
function drawBlocks(ctx: CanvasRenderingContext2D, blocks: BlockType[], s: number, isDark: boolean, fontFamily: string, W: number, H: number, showFooter = true, padLeft?: number) {
  const fg = isDark ? '#FFFFFF' : B.black
  const fgSub = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.6)'
  const font = (w: number, sz: number) => `${w} ${sz}px ${fontFamily}`
  const x = padLeft ?? 28 * s

  // Use 'top' baseline so text is positioned from its top edge (like CSS)
  ctx.textBaseline = 'top'

  // Available width for content
  const maxW = W - x - 28 * s

  // Vertically center content (matching the preview component's justifyContent: center)
  const footerH = showFooter ? 40 * s : 0
  const contentArea = H - footerH
  const totalHeight = measureBlocksHeight(ctx, blocks, s, fontFamily, W, padLeft)
  // If blocks overflow the canvas (e.g. cover formats), top-align with padding
  let y = totalHeight > contentArea - 32 * s
    ? 20 * s
    : Math.max(32 * s, (contentArea - totalHeight) / 2)

  for (const block of blocks) {
    switch (block.type) {
      case 'tag': {
        ctx.font = font(800, 10 * s)
        ctx.fillStyle = B.coral
        ctx.letterSpacing = `${2.5 * s}px`
        ctx.fillText(block.text, x, y)
        ctx.letterSpacing = '0px'
        y += 10 * s + 12 * s // fontSize + marginBottom
        break
      }

      case 'headline': {
        const sz = block.fontSize === 'sm' ? 22 * s : block.fontSize === 'md' ? 26 * s : 28 * s
        ctx.font = font(900, sz)
        ctx.fillStyle = isDark ? B.coral : fg
        const lines = wrapLines(ctx, block.text, maxW)
        for (const line of lines) {
          ctx.fillText(line, x, y)
          y += sz * 1.1
        }
        y += 14 * s
        break
      }

      case 'text': {
        ctx.font = font(500, 13 * s)
        ctx.fillStyle = fgSub
        const lines = wrapLines(ctx, block.text, maxW)
        for (const line of lines) {
          ctx.fillText(line, x, y)
          y += 13 * s * 1.55
        }
        break
      }

      case 'steps': {
        for (let i = 0; i < block.items.length; i++) {
          const badgeSize = 26 * s
          const bx = x
          const grd = ctx.createLinearGradient(bx, y, bx + badgeSize, y + badgeSize)
          grd.addColorStop(0, B.coral)
          grd.addColorStop(1, B.gold)
          ctx.fillStyle = grd
          ctx.beginPath()
          ctx.roundRect(bx, y, badgeSize, badgeSize, 8 * s)
          ctx.fill()
          // Number inside badge
          ctx.font = font(900, 12 * s)
          ctx.fillStyle = '#FFFFFF'
          ctx.textAlign = 'center'
          ctx.fillText(String(i + 1).padStart(2, '0'), bx + badgeSize / 2, y + (badgeSize - 12 * s) / 2)
          ctx.textAlign = 'left'
          // Step text centered with badge
          ctx.font = font(500, 13 * s)
          ctx.fillStyle = fgSub
          ctx.fillText(block.items[i], bx + badgeSize + 10 * s, y + (badgeSize - 13 * s) / 2)
          y += badgeSize + 10 * s
        }
        break
      }

      case 'bullets': {
        const textSize = 12.5 * s
        const bulletR = 3 * s
        for (let i = 0; i < block.items.length; i++) {
          ctx.fillStyle = B.coral
          ctx.beginPath()
          ctx.arc(x + bulletR, y + textSize * 0.5, bulletR, 0, Math.PI * 2)
          ctx.fill()
          ctx.font = font(500, textSize)
          ctx.fillStyle = fgSub
          ctx.fillText(block.items[i], x + 14 * s, y)
          y += 15 * s + (i < block.items.length - 1 ? 8 * s : 0)
        }
        break
      }

      case 'metric': {
        ctx.font = font(900, 32 * s)
        ctx.fillStyle = B.coral
        ctx.fillText(block.value, x, y)
        y += 32 * s + 4 * s
        ctx.font = font(600, 11 * s)
        ctx.fillStyle = fgSub
        ctx.letterSpacing = `${1.5 * s}px`
        ctx.fillText(block.label.toUpperCase(), x, y)
        ctx.letterSpacing = '0px'
        y += 11 * s + 8 * s
        break
      }

      case 'quote': {
        const quoteTextSize = 13 * s
        const lineH = quoteTextSize * 1.5
        ctx.font = `italic 500 ${quoteTextSize}px ${fontFamily}`
        const quoteMaxW = maxW - 12 * s
        const lines = wrapLines(ctx, `"${block.text}"`, quoteMaxW)
        const totalQuoteH = lines.length * lineH + (block.author ? 6 * s + 10 * s : 0)
        // Vertical bar alongside quote
        ctx.fillStyle = B.coral
        ctx.fillRect(x, y, 3 * s, totalQuoteH)
        // Font already set above for wrapLines measurement
        ctx.fillStyle = fgSub
        for (const line of lines) {
          ctx.fillText(line, x + 12 * s, y)
          y += lineH
        }
        if (block.author) {
          y += 6 * s
          ctx.font = font(700, 10 * s)
          ctx.fillStyle = B.coral
          ctx.fillText(`\u2014 ${block.author}`, x + 12 * s, y)
          y += 10 * s
        }
        y += 8 * s
        break
      }

      case 'spacer': {
        y += (block.height || 20) * s
        break
      }

      case 'table': {
        const colW = maxW / block.headers.length
        const headerH = 18 * s
        const rowH = 16 * s
        const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
        // Header bg
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
        ctx.fillRect(x, y, maxW, headerH)
        // Header text
        ctx.font = font(700, 9 * s)
        ctx.fillStyle = B.coral
        block.headers.forEach((h, i) => {
          ctx.fillText(h.toUpperCase(), x + i * colW + 8 * s, y + 5 * s)
        })
        // Header border
        ctx.fillStyle = borderColor
        ctx.fillRect(x, y + headerH, maxW, 1)
        y += headerH + 1
        // Rows
        ctx.font = font(500, 10 * s)
        ctx.fillStyle = fgSub
        for (let ri = 0; ri < block.rows.length; ri++) {
          const row = block.rows[ri]
          row.forEach((cell, ci) => {
            ctx.fillStyle = fgSub
            ctx.fillText(cell, x + ci * colW + 8 * s, y + 4 * s)
          })
          if (ri < block.rows.length - 1) {
            ctx.fillStyle = borderColor
            ctx.fillRect(x, y + rowH, maxW, 1)
          }
          y += rowH
        }
        if (block.caption) {
          ctx.font = `italic 500 ${8 * s}px ${fontFamily}`
          ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'
          ctx.fillText(block.caption, x + 8 * s, y + 2 * s)
          y += 12 * s
        }
        y += 12 * s
        break
      }

      case 'progress': {
        // Label (left)
        ctx.font = font(600, 11 * s)
        ctx.fillStyle = fgSub
        ctx.fillText(block.label, x, y)

        // Right side: "38% current -> 50% target" with mixed styles
        const unit = block.unit || ''
        const parts = [
          { text: `${block.value}${unit}`, font: font(800, 12 * s), color: B.coral },
          { text: ' current', font: font(500, 8 * s), color: fgSub },
          { text: ' \u2192 ', font: font(500, 9 * s), color: fgSub },
          { text: `${block.target}${unit}`, font: font(500, 9 * s), color: fgSub },
          { text: ' target', font: font(500, 8 * s), color: fgSub },
        ]
        // Measure total width
        let totalPctW = 0
        for (const p of parts) { ctx.font = p.font; totalPctW += ctx.measureText(p.text).width }
        // Draw each part
        let px = x + maxW - totalPctW
        for (const p of parts) {
          ctx.font = p.font
          ctx.fillStyle = p.color
          ctx.fillText(p.text, px, y)
          px += ctx.measureText(p.text).width
        }
        y += 11 * s + 4 * s
        // Bar bg
        const barH = 6 * s
        const barR = 3 * s
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
        ctx.beginPath()
        ctx.roundRect(x, y, maxW, barH, barR)
        ctx.fill()
        // Bar fill
        const fillW = maxW * Math.min(1, block.value / block.target)
        if (fillW > 0) {
          const grd = ctx.createLinearGradient(x, y, x + fillW, y)
          grd.addColorStop(0, B.coral)
          grd.addColorStop(1, B.gold)
          ctx.fillStyle = grd
          ctx.beginPath()
          ctx.roundRect(x, y, fillW, barH, barR)
          ctx.fill()
        }
        y += barH + 10 * s
        break
      }

      case 'dashboardCard': {
        const cardPad = 12 * s
        const cardBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
        const cardH = 55 * s
        // Card bg
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
        ctx.beginPath()
        ctx.roundRect(x, y, maxW, cardH, 8 * s)
        ctx.fill()
        // Card border
        ctx.strokeStyle = cardBorder
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(x, y, maxW, cardH, 8 * s)
        ctx.stroke()
        // Title (uppercase with letter-spacing)
        ctx.font = font(700, 9 * s)
        ctx.fillStyle = B.coral
        ctx.letterSpacing = `${1.5 * s}px`
        ctx.fillText(block.title.toUpperCase(), x + cardPad, y + 10 * s)
        ctx.letterSpacing = '0px'
        // Metrics row
        const metricW = (maxW - 2 * cardPad) / block.metrics.length
        const metricGap = 12 * s
        block.metrics.forEach((m, i) => {
          const mx = x + cardPad + i * (metricW + metricGap / block.metrics.length)
          // Value (large bold)
          ctx.font = font(900, 18 * s)
          ctx.fillStyle = fg
          ctx.fillText(m.value, mx, y + 10 * s + 12 * s)
          // Label (small uppercase muted)
          ctx.font = font(600, 7 * s)
          ctx.fillStyle = fgSub
          ctx.letterSpacing = `${0.5 * s}px`
          ctx.fillText(m.label.toUpperCase(), mx, y + 10 * s + 12 * s + 20 * s)
          ctx.letterSpacing = '0px'
        })
        y += cardH + 12 * s
        break
      }

      case 'screenshot': {
        const imgH = 80 * s
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
        ctx.beginPath()
        ctx.roundRect(x, y, maxW, imgH, 6 * s)
        ctx.fill()
        if (block.border) {
          ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.roundRect(x, y, maxW, imgH, 6 * s)
          ctx.stroke()
        }
        ctx.font = font(500, 10 * s)
        ctx.fillStyle = fgSub
        ctx.textAlign = 'center'
        ctx.fillText(block.alt || 'Image', x + maxW / 2, y + imgH / 2 - 5 * s)
        ctx.textAlign = 'left'
        y += imgH + 10 * s
        break
      }

      case 'artworkShowcase': {
        // Gallery frame style rectangle
        const frameH = 80 * s
        const framePad = 6 * s
        // Outer frame border
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'
        ctx.lineWidth = 2 * s
        ctx.beginPath()
        ctx.roundRect(x, y, maxW, frameH, 4 * s)
        ctx.stroke()
        // Inner area
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'
        ctx.beginPath()
        ctx.roundRect(x + framePad, y + framePad, maxW - 2 * framePad, frameH - 2 * framePad, 2 * s)
        ctx.fill()
        // Placeholder text
        ctx.font = font(500, 10 * s)
        ctx.fillStyle = fgSub
        ctx.textAlign = 'center'
        ctx.fillText(block.artworkTitle || 'Artwork', x + maxW / 2, y + frameH / 2 - 5 * s)
        ctx.textAlign = 'left'
        y += frameH + 6 * s
        // Title below frame
        ctx.font = font(800, 14 * s)
        ctx.fillStyle = fg
        ctx.fillText(block.artworkTitle, x, y)
        y += 14 * s + 4 * s
        // Artist name
        ctx.font = font(500, 10 * s)
        ctx.fillStyle = B.coral
        ctx.fillText(block.artistName, x, y)
        y += 10 * s
        break
      }

      case 'artistCredit': {
        // Artist name large
        ctx.font = font(900, 24 * s)
        ctx.fillStyle = isDark ? B.coral : fg
        ctx.fillText(block.artistName, x, y)
        y += 24 * s + 4 * s
        // Bio text smaller
        if (block.bio) {
          ctx.font = font(500, 12 * s)
          ctx.fillStyle = fgSub
          const lines = wrapLines(ctx, block.bio, maxW)
          for (const line of lines) {
            ctx.fillText(line, x, y)
            y += 14 * s
          }
        }
        y += 10 * s
        break
      }

      case 'editionInfo': {
        // "Edition X/Y" text
        const editionText = `Edition ${block.editionSold}/${block.editionSize}`
        ctx.font = font(800, 16 * s)
        ctx.fillStyle = fg
        ctx.fillText(editionText, x, y)
        y += 16 * s + 4 * s
        // Small progress indicator
        const indH = 4 * s
        const indR = 2 * s
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
        ctx.beginPath()
        ctx.roundRect(x, y, maxW * 0.5, indH, indR)
        ctx.fill()
        const pct = block.editionSize > 0 ? Math.min(1, block.editionSold / block.editionSize) : 0
        if (pct > 0) {
          const grd = ctx.createLinearGradient(x, y, x + maxW * 0.5 * pct, y)
          grd.addColorStop(0, B.coral)
          grd.addColorStop(1, B.gold)
          ctx.fillStyle = grd
          ctx.beginPath()
          ctx.roundRect(x, y, maxW * 0.5 * pct, indH, indR)
          ctx.fill()
        }
        y += indH + 10 * s
        break
      }

      case 'priceDisplay': {
        // Price in large text
        ctx.font = font(900, 28 * s)
        ctx.fillStyle = B.coral
        ctx.fillText(block.price || 'Price TBD', x, y)
        y += 28 * s + 4 * s
        // CTA below
        ctx.font = font(600, 12 * s)
        ctx.fillStyle = fgSub
        ctx.fillText(block.cta || 'Shop at artinscale.com', x, y)
        y += 14 * s + 10 * s
        break
      }

      case 'divider': {
        y += 8 * s
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
        ctx.fillRect(x, y, W - 2 * x, 1)
        y += 8 * s
        break
      }
    }
  }

  // Reset baseline
  ctx.textBaseline = 'alphabetic'
}

function drawFooter(ctx: CanvasRenderingContext2D, footer: string, isDark: boolean, s: number, fontFamily: string, W: number, H: number) {
  const footerH = 40 * s
  const footerY = H - footerH

  // Thin coral gradient line at top of footer
  const lineGrd = ctx.createLinearGradient(0, 0, W, 0)
  lineGrd.addColorStop(0, B.coral)
  lineGrd.addColorStop(1, B.gold)
  ctx.fillStyle = lineGrd
  ctx.fillRect(0, footerY, W, 0.5 * s)

  // Footer text (vertically centered in footer area)
  const textSize = 10 * s
  ctx.font = `700 ${textSize}px ${fontFamily}`
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)'
  ctx.textBaseline = 'middle'
  ctx.fillText(footer, 28 * s, footerY + footerH / 2)

  // A badge (vertically centered)
  const dSize = 20 * s
  const dx = W - 28 * s - dSize
  const dy = footerY + (footerH - dSize) / 2
  const grd = ctx.createLinearGradient(dx, dy, dx + dSize, dy + dSize)
  grd.addColorStop(0, B.coral)
  grd.addColorStop(1, B.gold)
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.roundRect(dx, dy, dSize, dSize, 5 * s)
  ctx.fill()

  // A letter centered in badge
  ctx.font = `900 ${11 * s}px ${fontFamily}`
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.fillText('A', dx + dSize / 2, dy + dSize / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

export async function renderPostToCanvas(config: VisualConfig | SlideConfig, scale = 2): Promise<HTMLCanvasElement> {
  await document.fonts.ready

  const slide = config as SlideConfig
  const fmt = getPostFormat(slide.format)
  const W = fmt.width
  const H = fmt.height
  const fontFamily = getResolvedFontFamily()
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!

  ctx.scale(scale, scale)
  const s = Math.min(W, H * (1080 / 1350)) / 340
  const isCover = fmt.category === 'cover'
  const padLeft = isCover ? Math.round(W * 0.25) : undefined

  drawBackground(ctx, slide as VisualConfig, W, H)
  drawAccent(ctx, slide.accent, s, W, H)
  drawBlocks(ctx, slide.blocks, s, slide.dark, fontFamily, W, H, !isCover, padLeft)
  if (!isCover) {
    drawFooter(ctx, slide.footer, slide.dark, s, fontFamily, W, H)
  }

  return canvas
}

export async function downloadPostAsPng(config: VisualConfig | SlideConfig, filename?: string) {
  const canvas = await renderPostToCanvas(config)

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png')
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename || `artinscale-post-${Date.now()}.png`
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

/** Download all slides in a carousel as individual PNGs */
export async function downloadCarouselAsPngs(config: VisualConfig, filenameBase?: string) {
  const slides = getSlides(config)
  const base = filenameBase || `artinscale-carousel-${Date.now()}`

  for (let i = 0; i < slides.length; i++) {
    try {
      console.log(`[export] Rendering slide ${i + 1}/${slides.length}...`)
      const canvas = await renderPostToCanvas(slides[i])
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png')
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `${base}-slide-${i + 1}.png`
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
      console.log(`[export] Slide ${i + 1} downloaded`)
      // Longer delay between downloads to avoid Chrome blocking
      if (i < slides.length - 1) await new Promise(r => setTimeout(r, 600))
    } catch (err) {
      console.error(`[export] Error on slide ${i + 1}:`, err)
    }
  }
}
