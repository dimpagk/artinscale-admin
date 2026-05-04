/**
 * Primitive helpers — defaults, labels, bounds, hit-testing.
 *
 * The "primitive" model lives in `lib/svg-layers.ts` (the
 * LayerPrimitive type + render/append). This module bundles the
 * pure functions ArtStudio uses to manipulate primitives in
 * memory: spawn defaults, compute axis-aligned bounds, hit-test
 * a point against the primitive stack.
 *
 * Kept dependency-free of React so server-side code (e.g. the
 * compose-raster route) can use it too if it ever needs to.
 */

import type { LayerPrimitive } from './svg-layers'

/**
 * Identity for an operator-tracked primitive. The id is stable
 * across renders + history undo/redo; the spec is the immutable
 * SVG spec data.
 */
export interface TrackedPrimitive {
  id: string
  spec: LayerPrimitive
}

/**
 * Axis-aligned bounding box in normalized 0..1 viewBox space.
 * Backgrounds return null since they fill the entire canvas and
 * don't have a meaningful bbox.
 */
export interface NormalizedBounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Default specs for each primitive kind — chosen to be visible on
 * a fresh canvas without further tweaking, so the operator sees
 * something the moment they click "Add".
 */
export function defaultPrimitiveSpec(kind: LayerPrimitive['kind']): LayerPrimitive {
  switch (kind) {
    case 'background':
      return { kind: 'background', color: '#f4ede1', opacity: 1 }
    case 'rect':
      return {
        kind: 'rect',
        color: '#e85d75',
        x: 0.2,
        y: 0.2,
        width: 0.6,
        height: 0.15,
        opacity: 1,
        cornerRadius: 0,
        rotate: 0,
      }
    case 'circle':
      return {
        kind: 'circle',
        color: '#3a5fcd',
        cx: 0.5,
        cy: 0.5,
        r: 0.4,
        opacity: 1,
      }
    case 'text':
      return {
        kind: 'text',
        color: '#1f1f1f',
        content: 'ART',
        x: 0.5,
        y: 0.55,
        size: 0.18,
        opacity: 1,
        fontFamily: 'Georgia, serif',
        fontWeight: 'bold',
        anchor: 'middle',
        rotate: 0,
      }
    case 'image':
      // Centered, half-canvas — operator can pull on the sliders or
      // re-pick the source from the right panel.
      return {
        kind: 'image',
        color: '#000000',
        url: '',
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
        opacity: 1,
        rotate: 0,
      }
  }
}

/**
 * Human-readable label for a primitive — used as the layer-row
 * name when no operator override is set.
 */
export function primitiveLabel(spec: LayerPrimitive): string {
  switch (spec.kind) {
    case 'background':
      return 'Background'
    case 'rect':
      return 'Rectangle'
    case 'circle':
      return 'Circle'
    case 'text':
      return spec.content ? `Text “${spec.content.slice(0, 16)}”` : 'Text'
    case 'image':
      return spec.label ? `Image: ${spec.label.slice(0, 18)}` : 'Image'
  }
}

/**
 * Tiny meta-string shown beside the layer name — size, dimensions,
 * radius, etc. Kept short so it fits in the panel.
 */
export function primitiveMeta(spec: LayerPrimitive): string {
  switch (spec.kind) {
    case 'background':
      return 'full canvas'
    case 'rect':
      return `${Math.round(spec.width * 100)}×${Math.round(spec.height * 100)}%`
    case 'circle':
      return `r ${Math.round(spec.r * 100)}%`
    case 'text':
      return `${Math.round(spec.size * 100)}% size`
    case 'image':
      return `${Math.round(spec.width * 100)}×${Math.round(spec.height * 100)}%${
        spec.rotate ? ` · ${Math.round(spec.rotate)}°` : ''
      }`
  }
}

/**
 * Axis-aligned bounds in normalized 0..1 viewBox space. Used for
 * canvas-side hit-testing and as the basis for the selection box.
 *
 * For text the bbox is approximate (size × content-length × heuristic)
 * — good enough for click selection, not pixel-perfect.
 *
 * Backgrounds return null; callers handle them as a fallback.
 */
export function primitiveBoundsNormalized(spec: LayerPrimitive): NormalizedBounds | null {
  switch (spec.kind) {
    case 'background':
      return null
    case 'rect':
    case 'image':
      return { x: spec.x, y: spec.y, w: spec.width, h: spec.height }
    case 'circle':
      return {
        x: spec.cx - spec.r * 0.5,
        y: spec.cy - spec.r * 0.5,
        w: spec.r,
        h: spec.r,
      }
    case 'text': {
      // Approximate — assume the text spans ~0.5 of its size on each
      // side of the anchor. Won't be pixel-perfect, but lets the
      // operator drag the text around predictably.
      const halfW = spec.size * (Math.max(spec.content.length, 4) * 0.25)
      const halfH = spec.size * 0.6
      const x =
        spec.anchor === 'middle'
          ? spec.x - halfW
          : spec.anchor === 'end'
            ? spec.x - halfW * 2
            : spec.x
      const y = spec.y - halfH
      return { x, y, w: halfW * 2, h: halfH * 2 }
    }
  }
}

/**
 * Find the topmost primitive (latest in array order = paints on top)
 * whose bbox contains the given normalized point. Background
 * primitives are caught last as a "fallback hit" so they only win
 * when nothing else does.
 *
 * Hit-testing is done against axis-aligned bboxes — for rotated
 * rect/image/text this is conservative (some pixels outside the
 * rotated shape register as hits). Acceptable for selection.
 */
export function hitTestPrimitive(
  primitives: TrackedPrimitive[],
  normX: number,
  normY: number
): string | null {
  // First pass: non-background primitives, top-down
  for (let i = primitives.length - 1; i >= 0; i--) {
    const p = primitives[i]
    if (p.spec.kind === 'background') continue
    if ((p.spec.opacity ?? 1) <= 0) continue
    const bounds = primitiveBoundsNormalized(p.spec)
    if (!bounds) continue
    if (
      normX >= bounds.x &&
      normX <= bounds.x + bounds.w &&
      normY >= bounds.y &&
      normY <= bounds.y + bounds.h
    ) {
      return p.id
    }
  }
  // Second pass: background — only matches if nothing else did
  for (let i = primitives.length - 1; i >= 0; i--) {
    const p = primitives[i]
    if (p.spec.kind !== 'background') continue
    if ((p.spec.opacity ?? 1) <= 0) continue
    return p.id
  }
  return null
}
