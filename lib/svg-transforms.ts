/**
 * Pointer-driven transform math for primitives on the canvas.
 *
 *   applyMove        — drag-to-move (delta in normalized coords)
 *   applyResize      — corner-resize anchor math (with optional aspect lock)
 *   detectAlignment  — smart-guide snap to other primitives + canvas
 *   clamp01, maybeSnap — small numeric helpers used across the above
 *
 * All functions are pure: they take a delta + the spec at the start
 * of the gesture and call `onChange` with the patch to apply. No
 * React, no DOM — same code can run server-side if we ever want to.
 */

import type { LayerPrimitive } from './svg-layers'
import type { NormalizedBounds } from './svg-primitives'

/** Snap-to-grid step for translate/resize when snap is enabled. */
export const SNAP_STEP = 0.05

/** Rotation snap step in degrees. */
export const SNAP_ROTATION_STEP = 15

/** Minimum primitive dimension (in normalized 0..1 space). */
export const MIN_PRIMITIVE_DIMENSION = 0.02

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Round to nearest SNAP_STEP when snap is on; pass-through otherwise.
 */
export function maybeSnap(v: number, snapEnabled: boolean): number {
  if (!snapEnabled) return v
  return Math.round(v / SNAP_STEP) * SNAP_STEP
}

/**
 * Translate a raw drag delta into a primitive update. Updates only
 * the position field(s) appropriate to the kind, leaving everything
 * else alone. Inputs are normalized 0..1 deltas.
 */
export function applyMove(
  spec: LayerPrimitive,
  startBounds: NormalizedBounds,
  dx: number,
  dy: number,
  snapEnabled: boolean,
  onChange: (patch: Partial<LayerPrimitive>) => void
): void {
  switch (spec.kind) {
    case 'rect':
    case 'image':
    case 'text': {
      const newX = clamp01(maybeSnap(startBounds.x + dx, snapEnabled))
      const newY = clamp01(maybeSnap(startBounds.y + dy, snapEnabled))
      onChange({ x: newX, y: newY })
      break
    }
    case 'circle': {
      const newCx = clamp01(maybeSnap(spec.cx + dx, snapEnabled))
      const newCy = clamp01(maybeSnap(spec.cy + dy, snapEnabled))
      onChange({ cx: newCx, cy: newCy })
      break
    }
    case 'background':
      // Not movable — full canvas
      break
  }
}

/**
 * Apply a corner-resize delta. Anchors the opposite corner so the box
 * grows/shrinks predictably from the dragged corner.
 *
 *   preserveAspect = true  → snap delta to start-bounds' diagonal so
 *                            width and height scale together. Sign
 *                            relationship between dx/dy depends on
 *                            which corner: nw/se same-sign, ne/sw
 *                            opposite-sign.
 */
export function applyResize(
  spec: LayerPrimitive,
  startBounds: NormalizedBounds,
  dx: number,
  dy: number,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  snapEnabled: boolean,
  preserveAspect: boolean,
  onChange: (patch: Partial<LayerPrimitive>) => void
): void {
  if (spec.kind === 'background') return

  const min = MIN_PRIMITIVE_DIMENSION

  if (preserveAspect && startBounds.w > 0 && startBounds.h > 0) {
    const aspect = startBounds.w / startBounds.h
    const sameSign = corner === 'nw' || corner === 'se'
    const direction = sameSign ? 1 : -1
    if (Math.abs(dx) >= Math.abs(dy * aspect)) {
      dy = (dx / aspect) * direction
    } else {
      dx = dy * aspect * direction
    }
  }

  let { x, y, w, h } = startBounds

  if (corner === 'nw') {
    const right = x + w
    const bottom = y + h
    x = Math.min(right - min, x + dx)
    y = Math.min(bottom - min, y + dy)
    w = right - x
    h = bottom - y
  } else if (corner === 'ne') {
    const bottom = y + h
    y = Math.min(bottom - min, y + dy)
    w = Math.max(min, w + dx)
    h = bottom - y
  } else if (corner === 'sw') {
    const right = x + w
    x = Math.min(right - min, x + dx)
    w = right - x
    h = Math.max(min, h + dy)
  } else {
    // se
    w = Math.max(min, w + dx)
    h = Math.max(min, h + dy)
  }

  // Clamp into 0..1
  x = Math.max(0, Math.min(1 - min, x))
  y = Math.max(0, Math.min(1 - min, y))
  w = Math.max(min, Math.min(1 - x, w))
  h = Math.max(min, Math.min(1 - y, h))

  if (snapEnabled) {
    x = clamp01(maybeSnap(x, snapEnabled))
    y = clamp01(maybeSnap(y, snapEnabled))
    w = Math.max(min, maybeSnap(w, snapEnabled))
    h = Math.max(min, maybeSnap(h, snapEnabled))
  }

  switch (spec.kind) {
    case 'rect':
    case 'image':
      onChange({ x, y, width: w, height: h })
      break
    case 'circle': {
      const r = Math.min(w, h)
      const cx = x + r / 2
      const cy = y + r / 2
      onChange({ cx, cy, r })
      break
    }
    case 'text': {
      const size = Math.max(min, Math.min(0.5, Math.max(w, h)))
      onChange({ x, y, size })
      break
    }
  }
}

/**
 * Smart-guide alignment detection. For the dragged primitive's
 * bounds, check left-edge / center-x / right-edge against each
 * sibling's same anchors (and likewise for the y-axis), plus the
 * canvas edges and centerlines. Returns the smallest delta within
 * `threshold`, plus the absolute position where the alignment occurs
 * (for rendering a guide line).
 *
 * Threshold is in normalized 0..1 space — 0.015 ≈ 1.5% which feels
 * close enough to "I want to align" but not so loose that you can't
 * place things off-grid.
 */
export interface AlignmentResult {
  xDelta: number
  yDelta: number
  vertGuide: number | null
  horizGuide: number | null
}

export function detectAlignment(
  myBounds: NormalizedBounds,
  siblings: NormalizedBounds[],
  threshold = 0.015
): AlignmentResult {
  if (siblings.length === 0) {
    return { xDelta: 0, yDelta: 0, vertGuide: null, horizGuide: null }
  }
  // Always include the canvas as a snap target — center + edges.
  const canvasAnchorsX = [0, 0.5, 1]
  const canvasAnchorsY = [0, 0.5, 1]
  const myXs = [myBounds.x, myBounds.x + myBounds.w / 2, myBounds.x + myBounds.w]
  const myYs = [myBounds.y, myBounds.y + myBounds.h / 2, myBounds.y + myBounds.h]
  const theirXs = [
    ...canvasAnchorsX,
    ...siblings.flatMap((s) => [s.x, s.x + s.w / 2, s.x + s.w]),
  ]
  const theirYs = [
    ...canvasAnchorsY,
    ...siblings.flatMap((s) => [s.y, s.y + s.h / 2, s.y + s.h]),
  ]

  let bestX: { delta: number; at: number } | null = null
  for (const m of myXs) {
    for (const t of theirXs) {
      const d = t - m
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.delta))) {
        bestX = { delta: d, at: t }
      }
    }
  }
  let bestY: { delta: number; at: number } | null = null
  for (const m of myYs) {
    for (const t of theirYs) {
      const d = t - m
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.delta))) {
        bestY = { delta: d, at: t }
      }
    }
  }

  return {
    xDelta: bestX?.delta ?? 0,
    yDelta: bestY?.delta ?? 0,
    vertGuide: bestX?.at ?? null,
    horizGuide: bestY?.at ?? null,
  }
}
