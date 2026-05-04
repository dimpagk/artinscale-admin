/**
 * SVG layer manipulation.
 *
 * vtracer's output is a flat SVG with `<path fill="#rrggbb" d="..."/>`
 * elements — one path per traced shape. Multiple paths can share a
 * fill color (the same flat region split into pieces by topology).
 *
 * For the operator, a "layer" is the union of all paths sharing a
 * fill. They want to toggle one off ("hide everything red"), recolor
 * one ("make the red ochre instead"), or stack ordering.
 *
 * This module:
 *   - parseLayers(svg) → Layer[]
 *   - applyLayers(svg, layers) → svg' with the layer state applied
 *
 * Implementation: pure regex over SVG strings. SVG output from vtracer
 * is well-formed enough that we can avoid pulling in a full XML
 * parser. If the operator wants to import arbitrary hand-authored
 * SVGs in the future, swap to `xmldom` / `parse5`.
 */

import { hexToHsl, hslToHex, normalizeColor } from './colors'

export interface ColorAdjust {
  /** -180..180 — hue rotation in degrees */
  hueShift: number
  /** -1..1 — relative lightness shift (negative = darker, positive = lighter) */
  lightnessDelta: number
  /** -1..1 — relative saturation shift */
  saturationDelta: number
}

export interface Layer {
  /** Stable id (the fill hex, lowercased) */
  id: string
  /** Current display color — may differ from `originalColor` after recolor */
  color: string
  /** Color in the source SVG, kept so "reset" is possible */
  originalColor: string
  /** Whether this layer should render */
  visible: boolean
  /** 0..1 — render opacity */
  opacity: number
  /** HSL adjustments applied on top of `color` (defaults all zero) */
  colorAdjust: ColorAdjust
  /** Approximate area as a fraction of the SVG's total fill area (0..1) */
  weight: number
  /** Number of distinct path elements in this layer */
  pathCount: number
}

const DEFAULT_ADJUST: ColorAdjust = {
  hueShift: 0,
  lightnessDelta: 0,
  saturationDelta: 0,
}

const FILL_RE = /<path[^>]*\bfill=(?:"|')([^"']+)(?:"|')[^>]*\/?>(?:<\/path>)?/g

/**
 * Extract one layer per distinct fill color.
 *
 * `weight` is computed crude: the proportion of total path string
 * length attributable to this color. It's a useful proxy for "size of
 * this layer" without parsing the path geometry.
 */
export function parseLayers(svg: string): Layer[] {
  const buckets = new Map<string, { color: string; pathCount: number; lengthSum: number }>()
  let totalLength = 0

  // Collect every path element + its fill
  const pathRe = /<path\b[^>]*?(?:\/>|>[^<]*<\/path>)/g
  for (const match of svg.matchAll(pathRe)) {
    const fillMatch = match[0].match(/\bfill=(?:"|')([^"']+)(?:"|')/)
    if (!fillMatch) continue
    const rawFill = fillMatch[1].trim().toLowerCase()
    if (rawFill === 'none' || rawFill === 'transparent') continue
    const fill = normalizeColor(rawFill)
    if (!fill) continue
    const pathLen = match[0].length
    const existing = buckets.get(fill)
    if (existing) {
      existing.pathCount += 1
      existing.lengthSum += pathLen
    } else {
      buckets.set(fill, { color: fill, pathCount: 1, lengthSum: pathLen })
    }
    totalLength += pathLen
  }

  return [...buckets.values()]
    .sort((a, b) => b.lengthSum - a.lengthSum)
    .map((b) => ({
      id: b.color,
      color: b.color,
      originalColor: b.color,
      visible: true,
      opacity: 1,
      colorAdjust: { ...DEFAULT_ADJUST },
      weight: totalLength > 0 ? b.lengthSum / totalLength : 0,
      pathCount: b.pathCount,
    }))
}

/**
 * Compute the final hex color for a layer after applying:
 *   1. The operator's recolor (`color` overrides `originalColor`)
 *   2. HSL hue shift (warm/cool)
 *   3. HSL lightness delta (highlights/shadows)
 *   4. HSL saturation delta (richer/muted)
 */
export function effectiveColor(layer: Layer): string {
  const adjust = layer.colorAdjust ?? DEFAULT_ADJUST
  const isAdjusted =
    adjust.hueShift !== 0 || adjust.lightnessDelta !== 0 || adjust.saturationDelta !== 0
  if (!isAdjusted) return layer.color
  const hsl = hexToHsl(layer.color)
  if (!hsl) return layer.color
  const newHue = (hsl.h + adjust.hueShift + 360) % 360
  const newL = clamp01(hsl.l + adjust.lightnessDelta)
  const newS = clamp01(hsl.s + adjust.saturationDelta)
  return hslToHex(newHue, newS, newL)
}

/**
 * Apply the operator's layer state back to an SVG.
 *
 * Walks every <path fill="#x">...</path> and:
 *   - if the matching layer is hidden → drop the path entirely
 *   - if the matching layer was recolored OR has color adjust → swap the fill
 *   - if opacity < 1 → add opacity attribute to the path
 *   - if no matching layer (color introduced after parse) → leave alone
 *
 * Per-path application keeps the SVG flat (no extra <g> wrappers), so
 * subsequent re-parses still work. Future transform support (move /
 * scale / rotate) will need <g> wrappers instead — leave a hook for
 * that here.
 */
export function applyLayers(svg: string, layers: Layer[]): string {
  const layerByOriginal = new Map(layers.map((l) => [l.originalColor, l]))
  return svg.replace(/<path\b[^>]*?(?:\/>|>[^<]*<\/path>)/g, (pathMarkup) => {
    const fillMatch = pathMarkup.match(/\bfill=(?:"|')([^"']+)(?:"|')/)
    if (!fillMatch) return pathMarkup
    const original = normalizeColor(fillMatch[1].trim().toLowerCase()) ?? fillMatch[1]
    const layer = layerByOriginal.get(original)
    if (!layer) return pathMarkup
    if (!layer.visible) return ''

    let updated = pathMarkup
    const finalColor = effectiveColor(layer)
    if (finalColor !== original) {
      updated = updated.replace(/\bfill=(?:"|')[^"']+(?:"|')/, `fill="${finalColor}"`)
    }
    if (layer.opacity < 1) {
      // Strip any pre-existing opacity, then inject ours
      updated = updated.replace(/\sopacity=(?:"|')[^"']+(?:"|')/g, '')
      updated = updated.replace(/<path\b/, `<path opacity="${layer.opacity.toFixed(3)}"`)
    }
    return updated
  })
}

/**
 * Like {@link applyLayers}, but with two additional capabilities:
 *
 *   1. Layer order matters. The output SVG re-emits paths in the
 *      `layers[]` array order (later = paints on top). This makes
 *      the operator's "move up / move down" controls actually
 *      restack the visual.
 *
 *   2. Hard-remove. Any layer whose `originalColor` is in
 *      `removedFills` is dropped entirely — its paths are deleted
 *      from the output, not just hidden. This is destructive on save
 *      (the resulting variant has fewer paths).
 *
 * Implementation:
 *   - Bucket every <path> by fill color into a map.
 *   - Walk layers in order; for each layer, emit its bucket of paths
 *     transformed (recolor / opacity / drop-if-hidden).
 *   - Replace the original [first…last] path span in the SVG with
 *     the re-emitted paths.
 *   - Paths whose fill doesn't match any layer get prepended (they
 *     paint behind everything else) so we don't lose them.
 */
export function applyLayersOrdered(
  svg: string,
  layers: Layer[],
  options?: { removedFills?: Set<string> }
): string {
  const removed = options?.removedFills ?? new Set<string>()
  const pathRe = /<path\b[^>]*?(?:\/>|>[^<]*<\/path>)/g

  // Find first + last path positions so we know what range to replace
  const matches = [...svg.matchAll(pathRe)]
  if (matches.length === 0) return svg

  const firstStart = matches[0].index ?? 0
  const lastMatch = matches[matches.length - 1]
  const lastEnd = (lastMatch.index ?? 0) + lastMatch[0].length

  // Bucket source paths by their fill (normalized lowercase hex)
  const byFill = new Map<string, string[]>()
  const unfilled: string[] = []
  for (const m of matches) {
    const fillMatch = m[0].match(/\bfill=(?:"|')([^"']+)(?:"|')/)
    if (!fillMatch) {
      unfilled.push(m[0])
      continue
    }
    const fill = normalizeColor(fillMatch[1].trim().toLowerCase()) ?? fillMatch[1]
    const list = byFill.get(fill) ?? []
    list.push(m[0])
    byFill.set(fill, list)
  }

  // Track every fill that maps to a known layer, regardless of
  // visibility/removal. Hidden layers must NOT fall through to the
  // orphan bucket below — that would silently re-emit them.
  const knownFills = new Set(layers.map((l) => l.originalColor))

  // Walk layers in order, emit transformed paths
  const emitted: string[] = []
  for (const layer of layers) {
    if (removed.has(layer.originalColor)) continue
    if (!layer.visible) continue

    const sourcePaths = byFill.get(layer.originalColor) ?? []
    const finalColor = effectiveColor(layer)
    for (const pathMarkup of sourcePaths) {
      let updated = pathMarkup
      if (finalColor !== layer.originalColor) {
        updated = updated.replace(
          /\bfill=(?:"|')[^"']+(?:"|')/,
          `fill="${finalColor}"`
        )
      }
      if (layer.opacity < 1) {
        updated = updated.replace(/\sopacity=(?:"|')[^"']+(?:"|')/g, '')
        updated = updated.replace(
          /<path\b/,
          `<path opacity="${layer.opacity.toFixed(3)}"`
        )
      }
      emitted.push(updated)
    }
  }

  // Truly orphan paths — fill doesn't match any known layer AND
  // wasn't explicitly removed. Rare; happens only if the SVG was
  // edited externally between parseLayers and applyLayersOrdered.
  // Hidden / removed layers are skipped here intentionally.
  const orphan: string[] = []
  for (const [fill, paths] of byFill) {
    if (knownFills.has(fill) || removed.has(fill)) continue
    orphan.push(...paths)
  }

  const replacement = unfilled.join('') + orphan.join('') + emitted.join('')
  return svg.slice(0, firstStart) + replacement + svg.slice(lastEnd)
}

// ============================================
// Internal helpers
// ============================================

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Count the number of distinct color layers in an SVG without a full
 * parse — useful for status badges.
 */
export function countLayers(svg: string): number {
  const colors = new Set<string>()
  for (const match of svg.matchAll(FILL_RE)) {
    const c = normalizeColor(match[1].trim().toLowerCase())
    if (c) colors.add(c)
  }
  return colors.size
}

// ============================================
// Adding new layers (primitives)
// ============================================

export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Pull the viewBox out of the root <svg> tag. Falls back to a
 * 1024×1024 default that matches the Claude vector generator and
 * vtracer-from-1024 raster output. Returning a default keeps the
 * Add-layer flow usable on SVGs that omit viewBox (rare but possible).
 */
export function parseViewBox(svg: string): ViewBox {
  const match = svg.match(/<svg\b[^>]*\bviewBox=(?:"|')([^"']+)(?:"|')/i)
  if (match) {
    const parts = match[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [x, y, width, height] = parts
      if (width > 0 && height > 0) return { x, y, width, height }
    }
  }

  // Try width/height attributes as a secondary signal.
  const wMatch = svg.match(/<svg\b[^>]*\bwidth=(?:"|')([^"']+)(?:"|')/i)
  const hMatch = svg.match(/<svg\b[^>]*\bheight=(?:"|')([^"']+)(?:"|')/i)
  const w = wMatch ? Number(String(wMatch[1]).replace(/[^0-9.]/g, '')) : NaN
  const h = hMatch ? Number(String(hMatch[1]).replace(/[^0-9.]/g, '')) : NaN
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { x: 0, y: 0, width: w, height: h }
  }

  return { x: 0, y: 0, width: 1024, height: 1024 }
}

/**
 * Specs for the four primitive shapes the operator can drop into an
 * SVG via the layer panel. All coordinates are normalized 0..1
 * relative to the viewBox so the controls don't have to know the
 * actual canvas size.
 */
export type LayerPrimitive =
  | {
      kind: 'background'
      color: string
      /** 0..1 */
      opacity?: number
    }
  | {
      kind: 'rect'
      color: string
      /** All values 0..1 relative to viewBox */
      x: number
      y: number
      width: number
      height: number
      opacity?: number
      /** 0..1 — corner radius as fraction of the smaller side */
      cornerRadius?: number
      /** Rotation in degrees, around the rectangle's center */
      rotate?: number
    }
  | {
      kind: 'circle'
      color: string
      /** 0..1 */
      cx: number
      cy: number
      /** 0..1 — radius relative to min(viewBox.width, viewBox.height) */
      r: number
      opacity?: number
    }
  | {
      kind: 'text'
      color: string
      content: string
      /** 0..1 */
      x: number
      y: number
      /** 0..1 — font size relative to min(viewBox.width, viewBox.height) */
      size: number
      opacity?: number
      fontFamily?: string
      fontWeight?: 'normal' | 'bold'
      anchor?: 'start' | 'middle' | 'end'
      /** Rotation in degrees, around the text anchor point */
      rotate?: number
    }
  | {
      kind: 'image'
      /** Source image (raster PNG or SVG) — embedded via SVG <image href>. */
      url: string
      /** Top-left corner, 0..1 of viewBox */
      x: number
      y: number
      /** Width / height as fraction of viewBox */
      width: number
      height: number
      opacity?: number
      /** Rotation in degrees, applied around the image's center */
      rotate?: number
      /** Tracking only — what generated_images row is this from */
      sourceImageId?: string
      /** Tracking only — human label so panel shows "Sun lit cliffside" not just "Image" */
      label?: string
      /** color is unused for images, but the discriminated union expects it.
       *  We default to '#000000' so the swatch in the panel doesn't blow up. */
      color: string
    }

/**
 * Produce the SVG markup for a primitive, scaled into the viewBox.
 * `id` is stamped onto the element so subsequent removals or edits
 * can target it without ambiguity.
 */
export function renderPrimitive(
  primitive: LayerPrimitive,
  viewBox: ViewBox,
  id: string
): string {
  const opacity = clamp01(primitive.opacity ?? 1)
  const opacityAttr = opacity < 1 ? ` opacity="${opacity.toFixed(3)}"` : ''
  const idAttr = ` data-added-layer="${id}"`

  switch (primitive.kind) {
    case 'background': {
      // Full viewBox rect — by convention this is the very first
      // child of the SVG so existing content paints on top.
      return `<rect${idAttr} x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="${primitive.color}"${opacityAttr}/>`
    }
    case 'rect': {
      const w = primitive.width * viewBox.width
      const h = primitive.height * viewBox.height
      const x = viewBox.x + primitive.x * viewBox.width
      const y = viewBox.y + primitive.y * viewBox.height
      const radius = primitive.cornerRadius
        ? clamp01(primitive.cornerRadius) * Math.min(w, h) * 0.5
        : 0
      const rx = radius > 0 ? ` rx="${radius.toFixed(2)}" ry="${radius.toFixed(2)}"` : ''
      const rotate = primitive.rotate ?? 0
      const transform =
        rotate !== 0
          ? ` transform="rotate(${rotate.toFixed(2)} ${(x + w / 2).toFixed(2)} ${(y + h / 2).toFixed(2)})"`
          : ''
      return `<rect${idAttr} x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"${rx} fill="${primitive.color}"${opacityAttr}${transform}/>`
    }
    case 'circle': {
      const cx = viewBox.x + primitive.cx * viewBox.width
      const cy = viewBox.y + primitive.cy * viewBox.height
      const r = primitive.r * Math.min(viewBox.width, viewBox.height) * 0.5
      return `<circle${idAttr} cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${primitive.color}"${opacityAttr}/>`
    }
    case 'text': {
      const x = viewBox.x + primitive.x * viewBox.width
      const y = viewBox.y + primitive.y * viewBox.height
      const fontSize = primitive.size * Math.min(viewBox.width, viewBox.height)
      const family = primitive.fontFamily ?? 'sans-serif'
      const weight = primitive.fontWeight ?? 'normal'
      const anchor = primitive.anchor ?? 'start'
      const escaped = escapeXml(primitive.content)
      const rotate = primitive.rotate ?? 0
      const transform =
        rotate !== 0
          ? ` transform="rotate(${rotate.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})"`
          : ''
      return `<text${idAttr} x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${fontSize.toFixed(2)}" font-family="${escapeXml(family)}" font-weight="${weight}" text-anchor="${anchor}" fill="${primitive.color}"${opacityAttr}${transform}>${escaped}</text>`
    }
    case 'image': {
      const w = primitive.width * viewBox.width
      const h = primitive.height * viewBox.height
      const x = viewBox.x + primitive.x * viewBox.width
      const y = viewBox.y + primitive.y * viewBox.height
      // Rotation pivots around the image's center so the slider feels
      // natural ("rotate this thing where it is", not "rotate around 0,0").
      const cx = x + w / 2
      const cy = y + h / 2
      const rotate = primitive.rotate ?? 0
      const transform =
        rotate !== 0
          ? ` transform="rotate(${rotate.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})"`
          : ''
      const href = escapeXml(primitive.url)
      // Use both `href` (modern) and `xlink:href` (legacy) attributes so
      // the embedded image renders in older SVG viewers. Most browsers
      // accept either.
      return `<image${idAttr} x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="${href}" xlink:href="${href}" preserveAspectRatio="xMidYMid meet"${transform}${opacityAttr}/>`
    }
  }
}

/**
 * Append a primitive to an SVG. Always inserts just before `</svg>`
 * so the primitive paints on top of whatever was previously there.
 *
 * Stack order is determined by the order the caller calls
 * appendPrimitive in — first call paints first (back), last call
 * paints last (front). The operator's primitives[] array order in
 * ArtStudio is the source of truth for stacking; this just emits
 * them in that order.
 *
 * Note: `kind: 'background'` is treated identically to other shapes
 * here. It's just a full-canvas rect. If the operator wants a
 * "behind everything" backdrop, they place it at index 0 of the
 * primitives array (= bottom of the layers panel). If they want it
 * to overlay everything else, they push it to the top of the panel.
 */
export function appendPrimitive(
  svg: string,
  primitive: LayerPrimitive,
  options?: { id?: string }
): { svg: string; id: string } {
  const viewBox = parseViewBox(svg)
  const id = options?.id ?? `added-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const markup = renderPrimitive(primitive, viewBox, id)

  if (svg.match(/<\/svg>\s*$/i)) {
    const updated = svg.replace(/<\/svg>(\s*)$/i, `${markup}</svg>$1`)
    return { svg: updated, id }
  }

  // Fallback: append at the end (malformed but at least lossless).
  return { svg: `${svg}${markup}`, id }
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ============================================
// Embedded image extraction
// ============================================

export interface EmbeddedImageSpec {
  url: string
  /** All values 0..1 normalized to the SVG's viewBox */
  x: number
  y: number
  width: number
  height: number
  opacity: number
  /** Degrees, around the image's center */
  rotate: number
  /** If the SVG had a `data-added-layer` attribute on the element,
   *  preserve it so a load-edit-save round-trip keeps the same id. */
  preservedId?: string
}

const IMAGE_TAG_RE = /<image\b[^>]*?\/?>/g

/**
 * Pull every embedded `<image>` element out of an SVG, returning
 * normalized 0..1 specs ready to live in primitives state.
 *
 * compose-raster outputs SVGs that embed the source raster as
 * `<image href="...">`, and operators can also add image layers via
 * the picker. Both are surfaced as editable primitives in ArtStudio.
 */
export function parseEmbeddedImages(svg: string): EmbeddedImageSpec[] {
  const viewBox = parseViewBox(svg)
  const result: EmbeddedImageSpec[] = []
  for (const match of svg.matchAll(IMAGE_TAG_RE)) {
    const markup = match[0]
    const href =
      attrValue(markup, 'xlink:href') ?? attrValue(markup, 'href')
    if (!href) continue
    const x = numericAttr(markup, 'x') ?? viewBox.x
    const y = numericAttr(markup, 'y') ?? viewBox.y
    const width = numericAttr(markup, 'width') ?? viewBox.width
    const height = numericAttr(markup, 'height') ?? viewBox.height
    const opacity = numericAttr(markup, 'opacity') ?? 1
    const transform = attrValue(markup, 'transform') ?? ''
    let rotate = 0
    const rotMatch = transform.match(/rotate\(\s*([-\d.]+)/)
    if (rotMatch) rotate = parseFloat(rotMatch[1])
    result.push({
      url: href,
      x: viewBox.width > 0 ? (x - viewBox.x) / viewBox.width : 0,
      y: viewBox.height > 0 ? (y - viewBox.y) / viewBox.height : 0,
      width: viewBox.width > 0 ? width / viewBox.width : 1,
      height: viewBox.height > 0 ? height / viewBox.height : 1,
      opacity,
      rotate,
      preservedId: attrValue(markup, 'data-added-layer'),
    })
  }
  return result
}

/**
 * Strip every `<image>` element from an SVG. We use this on load so
 * the in-memory `sourceSvg` only contains paths — embedded images
 * become first-class primitives that the operator can manipulate
 * (and that get re-emitted via appendPrimitive on save). Calling
 * applyLayersOrdered on a stripped SVG keeps things consistent and
 * avoids double-emitting the embedded image.
 */
export function stripEmbeddedImages(svg: string): string {
  return svg.replace(IMAGE_TAG_RE, '')
}

function attrValue(markup: string, attr: string): string | undefined {
  // Match either `attr="..."` or `attr='...'`. The attr name might
  // contain a colon (xlink:href) so escape it for the regex.
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markup.match(
    new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)')`)
  )
  if (!match) return undefined
  return match[1] ?? match[2]
}

function numericAttr(markup: string, attr: string): number | null {
  const v = attrValue(markup, attr)
  if (v == null) return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}
