'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Eye,
  EyeSlash,
  ArrowCounterClockwise,
  FloppyDisk,
  Plus,
  Trash,
  Square,
  Circle as CircleIcon,
  TextAa,
  PaintBucket,
  Image as ImageIcon,
  CaretUp,
  CaretDown,
  Stack,
  Lightning,
  PaperPlaneRight,
  ClockCounterClockwise,
  Selection,
  GitBranch,
  Copy,
  X,
  MagnifyingGlass,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowUUpLeft,
  ArrowUUpRight,
  GridFour,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { MaskBrush } from './mask-brush'
import {
  applyLayersOrdered,
  appendPrimitive,
  effectiveColor,
  parseLayers,
  parseViewBox,
  parseEmbeddedImages,
  stripEmbeddedImages,
  type Layer,
  type LayerPrimitive,
} from '@/lib/svg-layers'
import {
  defaultPrimitiveSpec,
  primitiveLabel,
  primitiveMeta,
  primitiveBoundsNormalized,
  hitTestPrimitive,
  type TrackedPrimitive,
  type NormalizedBounds,
} from '@/lib/svg-primitives'
import {
  applyMove,
  applyResize,
  detectAlignment,
  clamp01,
} from '@/lib/svg-transforms'
import { autoNameForColor, rotateHues } from '@/lib/colors'
import {
  MODEL_OPTIONS,
  ASPECT_RATIOS,
  type GeneratedImage,
  type GenerateParams,
  type ModelKey,
  type AspectRatioKey,
} from '@/lib/constants/art-generator'
import { listLaunchStylePacks, listStylePacks } from '@/lib/style-packs'

/**
 * ArtStudio — Figma-style 3-panel editor for a focused image.
 *
 *   ┌──────────────┬─────────────────────┬──────────────────────────┐
 *   │   LAYERS     │       CANVAS        │       PROPERTIES         │
 *   │              │                     │                          │
 *   │ ▸ traced     │   live SVG / PNG    │ if no selection:         │
 *   │ ▸ added      │   preview at the    │   image-level controls   │
 *   │              │   selected variant  │   (edit / save / fork)   │
 *   │ + add layer  │                     │                          │
 *   │              │   variant switcher  │ if layer selected:       │
 *   │              │   below             │   layer-level controls   │
 *   └──────────────┴─────────────────────┴──────────────────────────┘
 *
 *   Raster images get a "Vectorize" CTA in the layers panel — once
 *   traced, layers populate from the resulting SVG variants.
 *
 *   Replaces the older 2-panel ImageEditor + sibling LayerPanel /
 *   VectorStudio components for the focused-image workflow.
 */

// ============================================
// Shared types
// ============================================

interface VectorVariant {
  paletteName: string
  paletteHex: string[]
  svgUrl: string
  svgStoragePath: string
}

interface VectorMetadata {
  masterSvgUrl: string
  masterStoragePath: string
  colorBandCount: number
  variants: VectorVariant[]
  vectorizedAt: string
  isDryRun: boolean
}

/** Quick-fire raster edit templates — copied verbatim from the
 *  previous ImageEditor so muscle memory carries over. */
const EDIT_TEMPLATES: Array<{ label: string; instruction: string }> = [
  { label: 'Warmer light', instruction: 'Shift the lighting to a warmer amber palette without changing the composition.' },
  { label: 'Cooler light', instruction: 'Shift the lighting to a cooler blue-grey palette without changing the composition.' },
  { label: 'More negative space', instruction: 'Increase the negative space around the subject. Move the subject smaller and slightly off-center.' },
  { label: 'More grain / texture', instruction: 'Increase the visible grain and paper-fiber texture. Make the halftone pattern more pronounced in mid-tones.' },
  { label: 'Stronger palette', instruction: 'Make the palette more saturated and confident — pull every color closer to its locked hex value, drop any wandering tones.' },
  { label: 'Remove second subject', instruction: 'Remove the secondary subject entirely. Keep only the primary subject and rebalance the composition.' },
  { label: 'Cleaner contour', instruction: 'Make the contour line cleaner and more confident — single weight, no double lines, no jitter.' },
  { label: 'Simplify background', instruction: 'Simplify the background to a single tonal field. Remove all secondary detail behind the subject.' },
]

// ============================================
// Top-level component
// ============================================

interface ArtStudioProps {
  image: GeneratedImage
  /** Mutate-in-place handler — image-level edits flow through here. */
  onUpdate: (image: GeneratedImage) => void
  /** Sibling-creation handler — saveAsNew, fork, branched layer save. */
  onBranchCreated?: (image: GeneratedImage) => void
  onClose: () => void
}

export function ArtStudio({
  image,
  onUpdate,
  onBranchCreated,
  onClose,
}: ArtStudioProps) {
  const meta = (image.metadata as Record<string, unknown> | null) ?? {}
  const vector = (meta.vector as VectorMetadata | undefined) ?? null
  const hasVector = Boolean(vector && vector.variants.length > 0)

  // Active variant index — only meaningful when vector exists
  const [activeVariantIndex, setActiveVariantIndex] = useState(0)
  const variant = hasVector
    ? vector!.variants[Math.min(activeVariantIndex, vector!.variants.length - 1)]
    : null

  // SVG source for the active variant (fetched on demand)
  const [sourceSvg, setSourceSvg] = useState<string | null>(null)
  const [svgLoadError, setSvgLoadError] = useState<string | null>(null)
  const [layers, setLayers] = useState<Layer[]>([])
  const [primitives, setPrimitives] = useState<TrackedPrimitive[]>([])
  // Set of `Layer.originalColor` values the operator wants to delete
  // entirely on save (vs. just hiding via `visible: false`). Persisted
  // through to applyLayersOrdered + edit-svg-layers payload.
  const [removedFills, setRemovedFills] = useState<Set<string>>(new Set())

  // Selection state — Sets so we can support multi-select via
  // shift/cmd-click. Empty sets ⇒ "image-level properties" view in
  // the right panel. Mixing layer + primitive selection is allowed
  // but rare; the canvas overlay only renders when exactly one
  // primitive is selected.
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set())
  const [selectedPrimitiveIds, setSelectedPrimitiveIds] = useState<Set<string>>(
    new Set()
  )

  const replaceLayerSelection = useCallback((id: string | null) => {
    setSelectedLayerIds(id ? new Set([id]) : new Set())
    setSelectedPrimitiveIds(new Set())
  }, [])
  const replacePrimitiveSelection = useCallback((id: string | null) => {
    setSelectedPrimitiveIds(id ? new Set([id]) : new Set())
    setSelectedLayerIds(new Set())
  }, [])
  const toggleLayerSelection = useCallback((id: string) => {
    setSelectedLayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const togglePrimitiveSelection = useCallback((id: string) => {
    setSelectedPrimitiveIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => {
    setSelectedLayerIds(new Set())
    setSelectedPrimitiveIds(new Set())
  }, [])

  // Action state — vectorize / save / edit
  const [vectorizing, setVectorizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [variantName, setVariantName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Image picker — opens when the operator clicks "Add Image" or
  // "Replace image" on an existing image primitive. `replacingId` set
  // means the picker should overwrite an existing primitive's url
  // rather than insert a new one.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerReplacingId, setPickerReplacingId] = useState<string | null>(null)

  // Hovered primitive id — set when the operator mouses over a row
  // in the layers panel. Used to render a faint outline on the canvas
  // so it's obvious which row maps to which thing.
  const [hoveredPrimitiveId, setHoveredPrimitiveId] = useState<string | null>(null)

  // Layer-name overrides — operators can double-click any row to give
  // it a friendlier name (e.g. "Sun rays" instead of "#FFA500"). Keyed
  // by layer/primitive id. Ephemeral for now (cleared on variant switch
  // and not persisted in the SVG); can promote to a saved attribute
  // if it becomes important.
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({})
  const renameItem = useCallback((id: string, name: string) => {
    setNameOverrides((prev) => {
      const next = { ...prev }
      if (name.trim()) next[id] = name.trim()
      else delete next[id]
      return next
    })
  }, [])

  // Snap-to-grid — when on, drag/resize/rotate snap to 5%/15° increments
  const [snapEnabled, setSnapEnabled] = useState(false)

  // Transient confirmation banner shown after a successful save.
  // Auto-dismisses in 3s (matches typical toast behavior). Stored as
  // string so we know what to show; null = no toast.
  const [saveToast, setSaveToast] = useState<string | null>(null)
  useEffect(() => {
    if (!saveToast) return
    const timer = setTimeout(() => setSaveToast(null), 3000)
    return () => clearTimeout(timer)
  }, [saveToast])

  // ===== Undo / redo =====
  // Each "user action" pushes a snapshot of {layers, primitives,
  // removedFills} onto the past stack. Cmd+Z pops it. Cmd+Shift+Z
  // (or Cmd+Y) replays from the future stack. Continuous operations
  // (drag, slider) coalesce within a 500ms window keyed by the action
  // identifier so a single drag is ONE undo step, not 200.
  type EditSnapshot = {
    layers: Layer[]
    primitives: TrackedPrimitive[]
    removedFills: Set<string>
  }
  const [past, setPast] = useState<EditSnapshot[]>([])
  const [future, setFuture] = useState<EditSnapshot[]>([])

  // Mirror current state into a ref so commitHistory can capture the
  // pre-mutation snapshot synchronously (event handler → commit then
  // setState → next render mirrors the new state).
  const editStateRef = useRef<EditSnapshot>({ layers, primitives, removedFills })
  useEffect(() => {
    editStateRef.current = { layers, primitives, removedFills }
  }, [layers, primitives, removedFills])

  // Coalescing window — same key within 500ms doesn't push a new entry
  const lastCommitRef = useRef<{ key: string; time: number } | null>(null)

  const commitHistory = useCallback((key?: string) => {
    const now = Date.now()
    if (
      key &&
      lastCommitRef.current &&
      lastCommitRef.current.key === key &&
      now - lastCommitRef.current.time < 500
    ) {
      // Continuing an in-flight operation — keep the original snapshot,
      // just refresh the timestamp so further updates also coalesce.
      lastCommitRef.current.time = now
      return
    }
    const snapshot: EditSnapshot = {
      layers: editStateRef.current.layers,
      primitives: editStateRef.current.primitives,
      removedFills: new Set(editStateRef.current.removedFills),
    }
    setPast((p) => [...p.slice(-49), snapshot]) // keep last 50 entries
    setFuture([])
    if (key) lastCommitRef.current = { key, time: now }
    else lastCommitRef.current = null
  }, [])

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p
      const previous = p[p.length - 1]
      const current: EditSnapshot = {
        layers: editStateRef.current.layers,
        primitives: editStateRef.current.primitives,
        removedFills: new Set(editStateRef.current.removedFills),
      }
      setFuture((f) => [current, ...f].slice(0, 50))
      setLayers(previous.layers)
      setPrimitives(previous.primitives)
      setRemovedFills(previous.removedFills)
      lastCommitRef.current = null
      return p.slice(0, -1)
    })
  }, [])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const next = f[0]
      const current: EditSnapshot = {
        layers: editStateRef.current.layers,
        primitives: editStateRef.current.primitives,
        removedFills: new Set(editStateRef.current.removedFills),
      }
      setPast((p) => [...p, current].slice(-50))
      setLayers(next.layers)
      setPrimitives(next.primitives)
      setRemovedFills(next.removedFills)
      lastCommitRef.current = null
      return f.slice(1)
    })
  }, [])

  const canUndo = past.length > 0
  const canRedo = future.length > 0

  // ===== Load the active variant (or initialise raster mode) =====
  //
  // Two paths:
  //   - variant present → fetch its SVG, extract paths into traced
  //     layers, extract any embedded <image> elements into primitives.
  //     The sourceSvg used for layer rendering has those <image>
  //     elements stripped so they don't double-emit on save.
  //   - variant absent (raster mode, not yet vectorized) → inject a
  //     synthetic image primitive pointing at the source raster so
  //     the operator sees and can manipulate the base layer.
  useEffect(() => {
    setSvgLoadError(null)
    setLayers([])
    setPrimitives([])
    setRemovedFills(new Set())
    setSelectedLayerIds(new Set())
    setSelectedPrimitiveIds(new Set())
    setPast([])
    setFuture([])
    lastCommitRef.current = null
    setNameOverrides({})

    if (!variant) {
      setSourceSvg(null)
      // Raster mode — synthesize a base image primitive so the source
      // raster shows as an editable layer in the panel, just like any
      // image-as-layer. Operator can move/resize/hide it, add things
      // on top, and Save composes the result into a new SVG variant.
      setPrimitives([
        {
          id: 'base-raster',
          spec: {
            kind: 'image',
            color: '#000000',
            url: image.image_url,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            opacity: 1,
            rotate: 0,
            label: 'Source image',
          },
        },
      ])
      setVariantName('Composition')
      return
    }

    let cancelled = false
    setSourceSvg(null)
    fetch(variant.svgUrl)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then((svg) => {
        if (cancelled) return
        const stripped = stripEmbeddedImages(svg)
        setSourceSvg(stripped)
        setLayers(parseLayers(stripped))

        // Restore any embedded <image> elements as primitives so the
        // operator can keep editing them (move / resize / replace).
        const restored = parseEmbeddedImages(svg).map((img, i) => ({
          id:
            img.preservedId ??
            `loaded-${i}-${Math.random().toString(36).slice(2, 7)}`,
          spec: {
            kind: 'image' as const,
            color: '#000000',
            url: img.url,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            opacity: img.opacity,
            rotate: img.rotate,
            label: i === 0 ? 'Source image' : `Embedded image ${i + 1}`,
          },
        }))
        setPrimitives(restored)

        setVariantName(`${variant.paletteName} — edit`)
      })
      .catch((err) => {
        if (!cancelled) setSvgLoadError(err instanceof Error ? err.message : 'Could not load SVG')
      })
    return () => {
      cancelled = true
    }
  }, [variant?.svgUrl, variant?.paletteName, image.image_url])

  // ViewBox for raster-mode preview (image aspect ratio). Declared
  // ahead of previewSvg because previewSvg depends on it.
  const rasterViewBox = useMemo(() => {
    const ratio = ASPECT_RATIOS.find((r) => r.key === image.aspect_ratio)
    return { width: ratio?.width ?? 1024, height: ratio?.height ?? 1024 }
  }, [image.aspect_ratio])

  // ===== Live preview SVG (with layer + primitive edits applied) =====
  // Three modes:
  //   1. Vector loaded → apply layer edits + primitives on top
  //   2. Raster + primitives → wrap raster in a synthesized SVG
  //      (<image> + primitives) so the canvas shows the composite
  //   3. Raster only → no preview SVG (canvas falls back to <img>)
  const previewSvg = useMemo(() => {
    if (sourceSvg) {
      // Use the ordered variant so layer reorder + hard-remove flow
      // through to the live preview as well as the eventual save.
      let svg = applyLayersOrdered(sourceSvg, layers, { removedFills })
      for (const p of primitives) {
        svg = appendPrimitive(svg, p.spec, { id: p.id }).svg
      }
      return svg
    }
    if (!hasVector && primitives.length > 0) {
      // Synthesize an empty SVG with the right viewBox, then stack
      // primitives in array order. The base raster is the FIRST
      // primitive (auto-injected on init), so it paints first/back.
      const w = rasterViewBox.width
      const h = rasterViewBox.height
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"></svg>`
      for (const p of primitives) {
        svg = appendPrimitive(svg, p.spec, { id: p.id }).svg
      }
      return svg
    }
    return null
  }, [sourceSvg, layers, primitives, hasVector, rasterViewBox.width, rasterViewBox.height, removedFills])

  // Active viewBox for the rendered preview — drives drag-handle
  // coordinate translation in CanvasStage.
  const previewViewBox = useMemo(() => {
    if (sourceSvg) {
      return parseViewBox(sourceSvg)
    }
    return { x: 0, y: 0, ...rasterViewBox }
  }, [sourceSvg, rasterViewBox])

  // ===== Layer mutation helpers =====

  const updateLayer = useCallback(
    (id: string, patch: Partial<Layer>) => {
      // Auto-key history coalescing on (id × fields-touched) so e.g.
      // dragging the opacity slider produces ONE undo step, not 50.
      const fields = Object.keys(patch)
        .concat(patch.colorAdjust ? Object.keys(patch.colorAdjust).map((k) => `colorAdjust.${k}`) : [])
        .sort()
        .join(',')
      commitHistory(`layer:${id}:${fields}`)
      setLayers((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l
          return {
            ...l,
            ...patch,
            colorAdjust: patch.colorAdjust
              ? { ...l.colorAdjust, ...patch.colorAdjust }
              : l.colorAdjust,
          }
        })
      )
    },
    [commitHistory]
  )

  const resetLayer = useCallback(
    (id: string) => {
      commitHistory()
      setLayers((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l
          return {
            ...l,
            color: l.originalColor,
            visible: true,
            opacity: 1,
            colorAdjust: { hueShift: 0, lightnessDelta: 0, saturationDelta: 0 },
          }
        })
      )
    },
    [commitHistory]
  )

  // Reorder a traced color band — moves the layer in the layers[]
  // array, which dictates emit order on save (later = paints on top).
  const moveLayer = useCallback(
    (id: string, direction: -1 | 1) => {
      commitHistory()
      setLayers((prev) => {
        const idx = prev.findIndex((l) => l.id === id)
        if (idx < 0) return prev
        const target = idx + direction
        if (target < 0 || target >= prev.length) return prev
        const next = [...prev]
        const [item] = next.splice(idx, 1)
        next.splice(target, 0, item)
        return next
      })
    },
    [commitHistory]
  )

  // Hard-remove a traced color band — adds its originalColor to the
  // removedFills set. The live preview drops the paths immediately;
  // save persists by passing the set to /edit-svg-layers.
  const removeLayer = useCallback(
    (id: string) => {
      // Read layer info from the live ref instead of nesting a
      // setRemovedFills inside the setLayers updater — that pattern
      // breaks in React 18 Strict Mode where updaters can fire twice.
      const layer = editStateRef.current.layers.find((l) => l.id === id)
      if (!layer) return
      commitHistory()
      setRemovedFills((rf) => {
        const next = new Set(rf)
        next.add(layer.originalColor)
        return next
      })
      setLayers((prev) => prev.filter((l) => l.id !== id))
      setSelectedLayerIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [commitHistory]
  )

  const movePrimitive = useCallback(
    (id: string, direction: -1 | 1) => {
      commitHistory()
      setPrimitives((prev) => {
        const idx = prev.findIndex((p) => p.id === id)
        if (idx < 0) return prev
        const target = idx + direction
        if (target < 0 || target >= prev.length) return prev
        const next = [...prev]
        const [item] = next.splice(idx, 1)
        next.splice(target, 0, item)
        return next
      })
    },
    [commitHistory]
  )

  const updatePrimitive = useCallback(
    (id: string, patch: Partial<LayerPrimitive>) => {
      const fields = Object.keys(patch).sort().join(',')
      commitHistory(`primitive:${id}:${fields}`)
      setPrimitives((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p
          return { ...p, spec: { ...p.spec, ...patch } as LayerPrimitive }
        })
      )
    },
    [commitHistory]
  )

  const removePrimitive = useCallback(
    (id: string) => {
      commitHistory()
      setPrimitives((prev) => prev.filter((p) => p.id !== id))
      setSelectedPrimitiveIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [commitHistory]
  )

  /**
   * Duplicate a primitive — copies its spec, offsets the position by
   * 5% so the new copy is visible as a separate item, and inserts it
   * right after the original in the array (= just above in the panel).
   */
  const duplicatePrimitive = useCallback(
    (id: string) => {
      const original = editStateRef.current.primitives.find((p) => p.id === id)
      if (!original) return
      commitHistory()
      const newId = `added-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const offset = 0.05
      const cloned: LayerPrimitive = JSON.parse(
        JSON.stringify(original.spec)
      ) as LayerPrimitive
      // Offset the position field appropriate to the kind so the
      // duplicate visually doesn't sit exactly on top of the source.
      const spec = cloned as LayerPrimitive
      switch (spec.kind) {
        case 'rect':
        case 'image':
        case 'text':
          spec.x = Math.min(1, Math.max(0, spec.x + offset))
          spec.y = Math.min(1, Math.max(0, spec.y + offset))
          break
        case 'circle':
          spec.cx = Math.min(1, Math.max(0, spec.cx + offset))
          spec.cy = Math.min(1, Math.max(0, spec.cy + offset))
          break
        case 'background':
          // A duplicate background is a no-op visually unless colors
          // differ — but allow it for symmetry.
          break
      }
      setPrimitives((prev) => {
        const idx = prev.findIndex((p) => p.id === id)
        if (idx < 0) return [...prev, { id: newId, spec }]
        const next = [...prev]
        next.splice(idx + 1, 0, { id: newId, spec })
        return next
      })
      setSelectedPrimitiveIds(new Set([newId]))
      setSelectedLayerIds(new Set())
    },
    [commitHistory]
  )

  /**
   * Delete every currently-selected layer + primitive in one shot.
   *
   * Calling removeLayer/removePrimitive in a loop would push a
   * separate history entry per item AND each entry would capture the
   * same stale snapshot (editStateRef only updates between renders).
   * This batched version commits ONE pre-deletion snapshot and runs
   * all the removals from that same baseline — one Cmd+Z restores the
   * whole batch.
   */
  const deleteSelection = useCallback(() => {
    const layerIds = Array.from(selectedLayerIds)
    const primitiveIds = Array.from(selectedPrimitiveIds)
    if (layerIds.length === 0 && primitiveIds.length === 0) return

    commitHistory()

    if (primitiveIds.length > 0) {
      const idSet = new Set(primitiveIds)
      setPrimitives((prev) => prev.filter((p) => !idSet.has(p.id)))
      setSelectedPrimitiveIds(new Set())
    }
    if (layerIds.length > 0) {
      const idSet = new Set(layerIds)
      const layersBeingRemoved = editStateRef.current.layers.filter((l) =>
        idSet.has(l.id)
      )
      const fillsToBan = layersBeingRemoved.map((l) => l.originalColor)
      setRemovedFills((rf) => {
        const next = new Set(rf)
        for (const f of fillsToBan) next.add(f)
        return next
      })
      setLayers((prev) => prev.filter((l) => !idSet.has(l.id)))
      setSelectedLayerIds(new Set())
    }
  }, [selectedLayerIds, selectedPrimitiveIds, commitHistory])

  const addPrimitive = useCallback(
    (kind: LayerPrimitive['kind']) => {
      if (kind === 'image') {
        setPickerReplacingId(null)
        setPickerOpen(true)
        return
      }
      commitHistory()
      const id = `added-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const spec = defaultPrimitiveSpec(kind)
      setPrimitives((prev) => [...prev, { id, spec }])
      setSelectedPrimitiveIds(new Set([id]))
      setSelectedLayerIds(new Set())
    },
    [commitHistory]
  )

  const handlePickerSelect = useCallback(
    (picked: { url: string; sourceImageId?: string; label?: string }) => {
      commitHistory()
      if (pickerReplacingId) {
        // Replace url + label on the existing primitive
        setPrimitives((prev) =>
          prev.map((p) => {
            if (p.id !== pickerReplacingId) return p
            if (p.spec.kind !== 'image') return p
            return {
              ...p,
              spec: {
                ...p.spec,
                url: picked.url,
                sourceImageId: picked.sourceImageId,
                label: picked.label,
              },
            }
          })
        )
      } else {
        const id = `added-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
        const baseSpec = defaultPrimitiveSpec('image') as Extract<LayerPrimitive, { kind: 'image' }>
        const spec: LayerPrimitive = {
          ...baseSpec,
          url: picked.url,
          sourceImageId: picked.sourceImageId,
          label: picked.label,
        }
        setPrimitives((prev) => [...prev, { id, spec }])
        setSelectedPrimitiveIds(new Set([id]))
        setSelectedLayerIds(new Set())
      }
      setPickerOpen(false)
      setPickerReplacingId(null)
    },
    [pickerReplacingId, commitHistory]
  )

  const handleReplaceImage = useCallback((id: string) => {
    setPickerReplacingId(id)
    setPickerOpen(true)
  }, [])

  // ===== Save layered variant =====
  // Three save paths:
  //   1. Vector + layer/primitive edits → existing /edit-svg-layers
  //   2. Raster + primitives → /compose-raster (embeds raster as <image>
  //      and stamps primitives on top, saves as the first variant)
  //   3. Raster + no primitives → nothing to save (button disabled)
  const handleSaveVariant = async () => {
    setSaving(true)
    setError(null)
    try {
      let endpoint: string
      let body: Record<string, unknown>
      if (variant) {
        endpoint = `/api/art-generator/${image.id}/edit-svg-layers`
        body = {
          variant_index: activeVariantIndex,
          layers,
          primitives: primitives.map((p) => p.spec),
          removedFills: Array.from(removedFills),
          name: variantName.trim() || undefined,
        }
      } else {
        endpoint = `/api/art-generator/${image.id}/compose-raster`
        body = {
          primitives: primitives.map((p) => p.spec),
          name: variantName.trim() || undefined,
        }
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Save failed (${res.status})`)
      }
      const result = (await res.json()) as { image: GeneratedImage }
      onUpdate(result.image)

      // Auto-switch to the variant we just appended. Both endpoints
      // append the new variant to the END of metadata.vector.variants[]
      // so its index is variants.length - 1 in the updated image.
      const newVector = (result.image.metadata as Record<string, unknown> | null)?.vector as
        | { variants: VectorVariant[] }
        | undefined
      if (newVector && newVector.variants.length > 0) {
        setActiveVariantIndex(newVector.variants.length - 1)
      }

      // Show a transient confirmation banner. Auto-dismisses in 3s.
      const savedName = variantName.trim() || 'Composition'
      setSaveToast(`Saved as "${savedName}"`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ===== Vectorize (raster → SVG variants) =====
  const handleVectorize = async () => {
    setError(null)
    setVectorizing(true)
    try {
      // Build a starter set of palette variants — same logic the
      // dedicated VectorStudio uses, lifted here so vectorize-from-
      // ArtStudio gives the operator immediate playable variants
      // instead of just the master SVG.
      const stylePackId = (meta.stylePackId as string | undefined) ?? null
      const stylePack = stylePackId
        ? listStylePacks().find((p) => p.id === stylePackId)
        : null
      const base = stylePack?.palette.colors ?? ['#111111', '#fafafa', '#e63946']
      const paletteVariants = [
        {
          name: stylePack ? `${stylePack.persona.name} — locked` : 'Locked',
          colors: base,
        },
        { name: 'Warm shift', colors: rotateHues(base, 30) },
        { name: 'Cool shift', colors: rotateHues(base, -30) },
        {
          name: 'Mono',
          colors: ['#0F0F0F', '#444444', '#999999', '#DDDDDD', '#FFFFFF'],
        },
      ]

      const res = await fetch(`/api/art-generator/${image.id}/vector-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paletteVariants }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Vectorize failed (${res.status})`)
      }
      const result = (await res.json()) as { image: GeneratedImage }
      onUpdate(result.image)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vectorize failed')
    } finally {
      setVectorizing(false)
    }
  }

  // Resolve selection. The right-panel properties view handles
  // single-item selections; multi-item selection shows a summary in
  // PropertiesSidebar with batch actions. The canvas overlay only
  // renders when exactly one primitive is selected.
  const selectedLayer =
    selectedLayerIds.size === 1
      ? layers.find((l) => selectedLayerIds.has(l.id)) ?? null
      : null
  const selectedPrimitive =
    selectedPrimitiveIds.size === 1
      ? primitives.find((p) => selectedPrimitiveIds.has(p.id)) ?? null
      : null
  const totalSelectionCount = selectedLayerIds.size + selectedPrimitiveIds.size
  const isMultiSelect = totalSelectionCount > 1
  const hasSelection = totalSelectionCount > 0

  // Keyboard shortcuts
  //   Esc                     — clear selection
  //   Delete / Backspace      — remove the selected primitive or
  //                             hard-remove the selected traced layer
  //   Cmd/Ctrl+Z              — undo
  //   Cmd/Ctrl+Shift+Z, Y     — redo
  //
  // We bail out when an input/textarea is focused so backspace and
  // undo still work normally inside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
      const isEditableTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (e.target as HTMLElement | null)?.isContentEditable
      if (isEditableTarget) return

      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (meta && e.key.toLowerCase() === 'd') {
        // Cmd/Ctrl+D — duplicate the selected primitive (single
        // selection only; multi-select duplicate is ambiguous).
        if (selectedPrimitiveIds.size === 1) {
          e.preventDefault()
          const [id] = selectedPrimitiveIds
          duplicatePrimitive(id)
        }
        return
      }

      if (e.key === 'Escape') {
        if (totalSelectionCount > 0) {
          e.preventDefault()
          clearSelection()
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (totalSelectionCount > 0) {
          e.preventDefault()
          deleteSelection()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    totalSelectionCount,
    selectedPrimitiveIds,
    deleteSelection,
    duplicatePrimitive,
    clearSelection,
    undo,
    redo,
  ])

  return (
    <div className="relative grid h-[calc(100vh-220px)] min-h-[600px] grid-cols-[280px_minmax(0,1fr)_360px] gap-4">
      {/* Save toast — top-center of the studio area. Auto-dismisses
          in 3s; click ✕ to dismiss earlier. */}
      {saveToast && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-900 shadow-md">
            <FloppyDisk size={12} weight="fill" />
            {saveToast}
            <button
              type="button"
              onClick={() => setSaveToast(null)}
              className="rounded-full p-0.5 text-green-700 hover:bg-green-100"
            >
              <X size={10} />
            </button>
          </div>
        </div>
      )}

      {/* ===== LEFT: Layers ===== */}
      <LayersSidebar
        hasVector={hasVector}
        vectorizing={vectorizing}
        onVectorize={handleVectorize}
        vector={vector}
        activeVariantIndex={activeVariantIndex}
        onSwitchVariant={(idx) => {
          setActiveVariantIndex(idx)
          clearSelection()
        }}
        layers={layers}
        primitives={primitives}
        selectedLayerIds={selectedLayerIds}
        selectedPrimitiveIds={selectedPrimitiveIds}
        onSelectLayer={(id, opts) => {
          if (opts?.additive) toggleLayerSelection(id)
          else replaceLayerSelection(id)
        }}
        onSelectPrimitive={(id, opts) => {
          if (opts?.additive) togglePrimitiveSelection(id)
          else replacePrimitiveSelection(id)
        }}
        onClearSelection={clearSelection}
        onToggleLayer={(id, visible) => updateLayer(id, { visible })}
        onMoveLayer={moveLayer}
        onRemoveLayer={removeLayer}
        onTogglePrimitive={(id, opacity) => updatePrimitive(id, { opacity })}
        onRemovePrimitive={removePrimitive}
        onMovePrimitive={movePrimitive}
        onAddPrimitive={addPrimitive}
        sourceSvg={sourceSvg}
        svgLoadError={svgLoadError}
        onHoverPrimitive={setHoveredPrimitiveId}
        nameOverrides={nameOverrides}
        onRename={renameItem}
        onReorderPrimitives={(draggedId, targetId) => {
          // Reorder primitives[] so the dragged item lands at the
          // target's index. History snapshot first so it's undoable.
          if (draggedId === targetId) return
          commitHistory()
          setPrimitives((prev) => {
            const draggedIdx = prev.findIndex((p) => p.id === draggedId)
            const targetIdx = prev.findIndex((p) => p.id === targetId)
            if (draggedIdx < 0 || targetIdx < 0) return prev
            const next = [...prev]
            const [item] = next.splice(draggedIdx, 1)
            next.splice(targetIdx, 0, item)
            return next
          })
        }}
      />

      {/* ===== CENTER: Canvas ===== */}
      <CanvasStage
        image={image}
        hasVector={hasVector}
        variant={variant}
        previewSvg={previewSvg}
        sourceSvgPending={hasVector && !sourceSvg && !svgLoadError}
        viewBoxWidth={previewViewBox.width}
        viewBoxHeight={previewViewBox.height}
        primitives={primitives}
        // Drag/resize handles only render when exactly ONE primitive is
        // selected — multi-select needs explicit batch tooling.
        selectedPrimitive={!isMultiSelect ? selectedPrimitive : null}
        hoveredPrimitive={
          hoveredPrimitiveId
            ? primitives.find((p) => p.id === hoveredPrimitiveId) ?? null
            : null
        }
        onPrimitiveChange={updatePrimitive}
        onCanvasPrimitiveClick={(id, opts) => {
          if (opts.additive) togglePrimitiveSelection(id)
          else replacePrimitiveSelection(id)
        }}
        onCanvasEmptyClick={clearSelection}
        onBoxSelect={({ ids, additive }) => {
          if (ids.length === 0 && !additive) {
            clearSelection()
            return
          }
          if (additive) {
            // Add the hits to the existing selection
            setSelectedPrimitiveIds((prev) => {
              const next = new Set(prev)
              for (const id of ids) next.add(id)
              return next
            })
          } else {
            setSelectedPrimitiveIds(new Set(ids))
            setSelectedLayerIds(new Set())
          }
        }}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((v) => !v)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      {/* ===== RIGHT: Properties ===== */}
      <PropertiesSidebar
        image={image}
        hasSelection={hasSelection}
        hasVector={hasVector}
        selectedLayer={selectedLayer}
        selectedPrimitive={selectedPrimitive}
        isMultiSelect={isMultiSelect}
        multiSelectionCount={totalSelectionCount}
        onDeleteSelection={deleteSelection}
        onClearSelection={clearSelection}
        onUpdateLayer={updateLayer}
        onResetLayer={resetLayer}
        onUpdatePrimitive={updatePrimitive}
        onReplaceImage={handleReplaceImage}
        // image-level handlers
        onImageUpdate={onUpdate}
        onBranchCreated={onBranchCreated}
        onClose={onClose}
        // save layered variant
        canSaveVariant={
          hasVector ? Boolean(sourceSvg) : primitives.length > 0
        }
        showSaveFooter={hasVector || primitives.length > 0}
        saveLabel={hasVector ? 'Save variant' : 'Compose & save'}
        variantName={variantName}
        onVariantNameChange={setVariantName}
        onSaveVariant={handleSaveVariant}
        saving={saving}
        // shared error
        error={error}
        onErrorClear={() => setError(null)}
      />

      {/* Image picker modal */}
      {pickerOpen && (
        <ImagePickerModal
          excludeImageId={image.id}
          // Pre-fill the "Generate new" tab with the focused image's
          // topic + style pack so the new layer feels coherent with
          // the parent piece, not random.
          defaultStylePackId={(meta.stylePackId as string | undefined) ?? ''}
          defaultTopicId={image.topic_id ?? null}
          defaultAspectRatio={image.aspect_ratio as AspectRatioKey}
          defaultPromptSeed={image.prompt}
          onPick={handlePickerSelect}
          onClose={() => {
            setPickerOpen(false)
            setPickerReplacingId(null)
          }}
        />
      )}
    </div>
  )
}

// ============================================
// Left panel: Layers
// ============================================

interface LayersSidebarProps {
  hasVector: boolean
  vectorizing: boolean
  onVectorize: () => void
  vector: VectorMetadata | null
  activeVariantIndex: number
  onSwitchVariant: (index: number) => void
  layers: Layer[]
  primitives: TrackedPrimitive[]
  selectedLayerIds: Set<string>
  selectedPrimitiveIds: Set<string>
  /** When `additive` is true the click should toggle the row in/out
   *  of the existing selection (shift/cmd-click). Otherwise replace. */
  onSelectLayer: (id: string, opts?: { additive?: boolean }) => void
  onSelectPrimitive: (id: string, opts?: { additive?: boolean }) => void
  onClearSelection: () => void
  onToggleLayer: (id: string, visible: boolean) => void
  onMoveLayer: (id: string, direction: -1 | 1) => void
  onRemoveLayer: (id: string) => void
  onTogglePrimitive: (id: string, opacity: number) => void
  onRemovePrimitive: (id: string) => void
  onMovePrimitive: (id: string, direction: -1 | 1) => void
  onAddPrimitive: (kind: LayerPrimitive['kind']) => void
  sourceSvg: string | null
  svgLoadError: string | null
  onHoverPrimitive: (id: string | null) => void
  /** Map of id → custom display name for both layers and primitives. */
  nameOverrides: Record<string, string>
  onRename: (id: string, newName: string) => void
  /** HTML5 drag-and-drop reorder for primitives. */
  onReorderPrimitives: (draggedId: string, targetId: string) => void
}

function LayersSidebar({
  hasVector,
  vectorizing,
  onVectorize,
  vector,
  activeVariantIndex,
  onSwitchVariant,
  layers,
  primitives,
  selectedLayerIds,
  selectedPrimitiveIds,
  onSelectLayer,
  onSelectPrimitive,
  onClearSelection,
  onToggleLayer,
  onMoveLayer,
  onRemoveLayer,
  onTogglePrimitive,
  onRemovePrimitive,
  onMovePrimitive,
  onAddPrimitive,
  sourceSvg,
  svgLoadError,
  onHoverPrimitive,
  nameOverrides,
  onRename,
  onReorderPrimitives,
}: LayersSidebarProps) {
  // Track which primitive id is being dragged so we can highlight the
  // drop target underneath the pointer.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  return (
    <aside className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span
          className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-gray-900"
          onClick={onClearSelection}
          title="Click to clear layer selection"
        >
          <Stack size={14} weight="duotone" />
          Layers
        </span>
        {hasVector && vector && vector.colorBandCount > 0 && (
          <Badge variant="success" size="sm">
            {vector.colorBandCount} {vector.colorBandCount === 1 ? 'color' : 'colors'}
          </Badge>
        )}
      </header>

      {/* Variant switcher */}
      {hasVector && vector && vector.variants.length > 1 && (
        <div className="border-b border-gray-100 px-3 py-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Variant
          </label>
          <div className="mt-1 flex flex-wrap gap-1">
            {vector.variants.map((v, i) => (
              <button
                key={`${v.svgStoragePath}-${i}`}
                type="button"
                onClick={() => onSwitchVariant(i)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  i === activeVariantIndex
                    ? 'border-pink-300 bg-pink-50 text-pink-800'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                }`}
                title={v.paletteName}
              >
                <span className="flex">
                  {v.paletteHex.slice(0, 4).map((c, idx) => (
                    <span
                      key={`${c}-${idx}`}
                      className="-ml-0.5 h-2.5 w-2.5 rounded-full border border-white first:ml-0"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="line-clamp-1 max-w-[8rem]">{v.paletteName}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* SVG load error */}
        {hasVector && svgLoadError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            Could not load variant SVG: {svgLoadError}
          </div>
        )}

        {/* SVG loading */}
        {hasVector && !sourceSvg && !svgLoadError && (
          <p className="px-1 py-3 text-center text-xs text-gray-500">
            Loading layers…
          </p>
        )}

        {/* Top of stack: added primitives, then traced bands, then base.
            We render top-of-stack first so the visual order matches
            Figma's convention (top of panel = on top of canvas). */}

        {/* Added primitives — paint on top of everything else.
            Reverse of the array because primitives[last] paints on top. */}
        {primitives.length > 0 && (
          <div className="space-y-1">
            <p className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Added ({primitives.length})
            </p>
            {[...primitives].reverse().map((p) => {
              const idx = primitives.findIndex((x) => x.id === p.id)
              const displayName = nameOverrides[p.id] ?? primitiveLabel(p.spec)
              return (
                <LayerRow
                  key={p.id}
                  color={p.spec.color}
                  thumbUrl={p.spec.kind === 'image' ? p.spec.url : undefined}
                  name={displayName}
                  meta={primitiveMeta(p.spec)}
                  visible={(p.spec.opacity ?? 1) > 0}
                  opacity={p.spec.opacity ?? 1}
                  selected={selectedPrimitiveIds.has(p.id)}
                  onSelect={(opts) => onSelectPrimitive(p.id, opts)}
                  onHover={(entering) =>
                    onHoverPrimitive(entering ? p.id : null)
                  }
                  onRename={(name) => onRename(p.id, name)}
                  onToggleVisible={() =>
                    onTogglePrimitive(p.id, (p.spec.opacity ?? 1) > 0 ? 0 : 1)
                  }
                  // "Up" in panel = paints later = +1 in array index
                  onMoveUp={() => onMovePrimitive(p.id, 1)}
                  onMoveDown={() => onMovePrimitive(p.id, -1)}
                  upDisabled={idx === primitives.length - 1}
                  downDisabled={idx === 0}
                  onRemove={() => onRemovePrimitive(p.id)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', p.id)
                    setDraggingId(p.id)
                  }}
                  onDragOver={(e) => {
                    if (!draggingId || draggingId === p.id) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const draggedId = e.dataTransfer.getData('text/plain')
                    setDraggingId(null)
                    if (draggedId && draggedId !== p.id) {
                      onReorderPrimitives(draggedId, p.id)
                    }
                  }}
                  isDropTarget={Boolean(draggingId) && draggingId !== p.id}
                />
              )
            })}
          </div>
        )}

        {/* Traced color bands — between primitives (above) and base (below). */}
        {hasVector && sourceSvg && layers.length > 0 && (
          <div className={primitives.length > 0 ? 'mt-3 space-y-1' : 'space-y-1'}>
            <p className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Traced ({layers.length})
            </p>
            {[...layers].reverse().map((layer) => {
              const idx = layers.findIndex((x) => x.id === layer.id)
              const displayName =
                nameOverrides[layer.id] ?? autoNameForColor(layer.color)
              return (
                <LayerRow
                  key={layer.id}
                  color={effectiveColor(layer)}
                  name={displayName}
                  meta={`${(layer.weight * 100).toFixed(0)}% · ${layer.pathCount} paths`}
                  visible={layer.visible}
                  opacity={layer.opacity}
                  selected={selectedLayerIds.has(layer.id)}
                  onSelect={(opts) => onSelectLayer(layer.id, opts)}
                  onRename={(name) => onRename(layer.id, name)}
                  onToggleVisible={() => onToggleLayer(layer.id, !layer.visible)}
                  // "Up" in panel = paints later = +1 in array index
                  onMoveUp={() => onMoveLayer(layer.id, 1)}
                  onMoveDown={() => onMoveLayer(layer.id, -1)}
                  upDisabled={idx === layers.length - 1}
                  downDisabled={idx === 0}
                  onRemove={() => onRemoveLayer(layer.id)}
                />
              )
            })}
          </div>
        )}

        {/* Vectorize CTA — for raster mode (no traced bands yet).
            The source raster shows as the bottom primitive above; this
            offers to extract its color regions into editable bands. */}
        {!hasVector && (
          <div className="mt-3">
            <button
              type="button"
              onClick={onVectorize}
              disabled={vectorizing}
              className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:border-gray-500 hover:bg-gray-50 disabled:opacity-50"
              title="Trace the source image into editable color-band layers"
            >
              <Lightning size={11} weight="bold" />
              {vectorizing ? 'Vectorizing…' : 'Vectorize into color bands'}
            </button>
          </div>
        )}
      </div>

      {/* Add layer — available on both rasters and vectors. For
          rasters, primitives stack on top of the source image and are
          baked into a new SVG variant on save. */}
      <div className="space-y-1.5 border-t border-gray-100 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Add layer
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <AddLayerButton
            icon={<PaintBucket size={11} weight="bold" />}
            label="Background"
            onClick={() => onAddPrimitive('background')}
          />
          <AddLayerButton
            icon={<Square size={11} weight="bold" />}
            label="Rectangle"
            onClick={() => onAddPrimitive('rect')}
          />
          <AddLayerButton
            icon={<CircleIcon size={11} weight="bold" />}
            label="Circle"
            onClick={() => onAddPrimitive('circle')}
          />
          <AddLayerButton
            icon={<TextAa size={11} weight="bold" />}
            label="Text"
            onClick={() => onAddPrimitive('text')}
          />
          <AddLayerButton
            icon={<ImageIcon size={11} weight="bold" />}
            label="Image"
            onClick={() => onAddPrimitive('image')}
          />
        </div>
        {!hasVector && (
          <p className="text-[10px] leading-snug text-gray-500">
            Adding a layer to a raster will save as a new SVG variant
            with the original embedded as the base layer.
          </p>
        )}
      </div>
    </aside>
  )
}

interface LayerRowProps {
  color: string
  /** Optional URL — when present we render a thumbnail instead of the color swatch */
  thumbUrl?: string
  name: string
  meta?: string
  visible: boolean
  opacity: number
  selected: boolean
  /** opts.additive when shift/cmd is held — caller should toggle in the
   *  selection set rather than replacing it. */
  onSelect: (opts?: { additive?: boolean }) => void
  /** Mouse enter (true) / leave (false) — used to drive the canvas
   *  hover outline so the operator can map row → object. */
  onHover?: (entering: boolean) => void
  /** Double-click the name to rename — empty string clears the override. */
  onRename?: (newName: string) => void
  onToggleVisible: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  upDisabled?: boolean
  downDisabled?: boolean
  upTitle?: string
  downTitle?: string
  onRemove?: () => void
  /** HTML5 drag-and-drop reorder handlers. */
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  isDropTarget?: boolean
}

function LayerRow({
  color,
  thumbUrl,
  name,
  meta,
  visible,
  opacity,
  selected,
  onSelect,
  onHover,
  onRename,
  onToggleVisible,
  onMoveUp,
  onMoveDown,
  upDisabled,
  downDisabled,
  upTitle,
  downTitle,
  onRemove,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  isDropTarget,
}: LayerRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  useEffect(() => {
    if (!editing) setDraft(name)
  }, [name, editing])

  const commitRename = () => {
    setEditing(false)
    if (!onRename) return
    onRename(draft.trim())
  }

  return (
    <div
      onClick={(e) => onSelect({ additive: e.shiftKey || e.metaKey || e.ctrlKey })}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
        selected
          ? 'border-pink-300 bg-pink-50'
          : isDropTarget
            ? 'border-blue-300 bg-blue-50/50'
            : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
      } ${visible ? '' : 'opacity-60'}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleVisible()
        }}
        className="rounded p-0.5 text-gray-700 hover:bg-gray-200/50"
        title={visible ? 'Hide layer' : 'Show layer'}
      >
        {visible ? <Eye size={13} weight="duotone" /> : <EyeSlash size={13} weight="duotone" />}
      </button>
      {thumbUrl ? (
        <span
          className="h-4 w-4 flex-shrink-0 overflow-hidden rounded border border-gray-300"
          style={{ opacity }}
        >
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        </span>
      ) : (
        <span
          className="h-4 w-4 flex-shrink-0 rounded border border-gray-300"
          style={{ backgroundColor: color, opacity }}
        />
      )}
      {editing && onRename ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename()
            } else if (e.key === 'Escape') {
              setEditing(false)
              setDraft(name)
            }
          }}
          className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px] font-medium text-gray-800 focus:border-pink-400 focus:outline-none"
          placeholder="Layer name"
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate font-medium text-gray-800"
          onDoubleClick={(e) => {
            if (!onRename) return
            e.stopPropagation()
            setEditing(true)
          }}
          title={onRename ? 'Double-click to rename' : undefined}
        >
          {name}
        </span>
      )}
      {meta && (
        <span className="hidden flex-shrink-0 truncate text-[10px] text-gray-400 group-hover:inline">
          {meta}
        </span>
      )}
      <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoveUp()
          }}
          disabled={upDisabled}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-200/50 disabled:cursor-not-allowed disabled:opacity-40"
          title={upTitle ?? 'Move up'}
        >
          <CaretUp size={10} weight="bold" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoveDown()
          }}
          disabled={downDisabled}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-200/50 disabled:cursor-not-allowed disabled:opacity-40"
          title={downTitle ?? 'Move down'}
        >
          <CaretDown size={10} weight="bold" />
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="rounded p-0.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
            title="Remove layer"
          >
            <Trash size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

function AddLayerButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
    >
      <Plus size={9} weight="bold" />
      {icon}
      {label}
    </button>
  )
}

// ============================================
// Center panel: Canvas
// ============================================

interface CanvasStageProps {
  image: GeneratedImage
  hasVector: boolean
  variant: VectorVariant | null
  previewSvg: string | null
  sourceSvgPending: boolean
  /** SVG viewBox dimensions — for translating mouse → normalized coords. */
  viewBoxWidth: number
  viewBoxHeight: number
  /** Full primitives array — used for hit-testing canvas clicks. */
  primitives: TrackedPrimitive[]
  /** Currently-selected primitive (drag handles render around it). */
  selectedPrimitive: TrackedPrimitive | null
  /** A separately-tracked "hovered" primitive, e.g. from layer-row hover. */
  hoveredPrimitive: TrackedPrimitive | null
  onPrimitiveChange: (id: string, patch: Partial<LayerPrimitive>) => void
  /** Click on a primitive on canvas — additive=true if shift/cmd held. */
  onCanvasPrimitiveClick: (id: string, opts: { additive: boolean }) => void
  /** Click on empty canvas — clear selection. */
  onCanvasEmptyClick: () => void
  /** Box-select drag complete — `ids` is every primitive whose bbox
   *  intersected the rubber-band rect, in array order. */
  onBoxSelect: (opts: { ids: string[]; additive: boolean }) => void
  // History + snap controls — rendered as a toolbar above the canvas.
  snapEnabled: boolean
  onToggleSnap: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

function CanvasStage({
  image,
  hasVector,
  variant,
  previewSvg,
  sourceSvgPending,
  viewBoxWidth,
  viewBoxHeight,
  primitives,
  selectedPrimitive,
  hoveredPrimitive,
  onPrimitiveChange,
  onCanvasPrimitiveClick,
  onCanvasEmptyClick,
  onBoxSelect,
  snapEnabled,
  onToggleSnap,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: CanvasStageProps) {
  // Ref on the SVG container — needed to translate pointer pixel
  // coords into normalized 0..1 viewBox coords for drag handles.
  const stageRef = useRef<HTMLDivElement | null>(null)

  // Zoom + pan state. Transform applies via CSS on the inner stage
  // wrapper. `getBoundingClientRect` on the SVG returns post-transform
  // dimensions, so the existing hit-test + handle-positioning math
  // still works without changes.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const zoomIn = () => setZoom((z) => Math.min(4, z * 1.2))
  const zoomOut = () => setZoom((z) => Math.max(0.25, z / 1.2))
  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // Pan via middle-mouse drag. Simple: capture pointerdown with
  // button=1 (middle), track delta, apply to pan state.
  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const startPan = pan
    const onMove = (ev: PointerEvent) => {
      setPan({
        x: startPan.x + (ev.clientX - startX),
        y: startPan.y + (ev.clientY - startY),
      })
    }
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Cmd/Ctrl + wheel = zoom centered on stage. Plain wheel scrolls
  // the page (don't intercept). Native browsers also conflate
  // touchpad pinch with wheel events; we treat pinch (deltaY) the
  // same as ctrl-wheel.
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setZoom((z) => Math.max(0.25, Math.min(4, z * factor)))
  }

  // Box-select state — non-null when the operator is dragging a
  // rubber-band rectangle on empty canvas. Coordinates are in viewport
  // pixels (clientX/clientY) for direct rendering as a positioned div.
  const [boxSelect, setBoxSelect] = useState<{
    startX: number
    startY: number
    endX: number
    endY: number
  } | null>(null)

  return (
    <div className="flex flex-col gap-3 overflow-hidden">
      {/* Top toolbar: undo/redo + snap toggle + variant info */}
      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded-md p-1 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          title={canUndo ? 'Undo last change (⌘Z / Ctrl+Z)' : 'Nothing to undo'}
        >
          <ArrowUUpLeft size={14} weight="bold" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="rounded-md p-1 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          title={canRedo ? 'Redo (⇧⌘Z / Ctrl+Shift+Z)' : 'Nothing to redo'}
        >
          <ArrowUUpRight size={14} weight="bold" />
        </button>
        <button
          type="button"
          onClick={onToggleSnap}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
            snapEnabled
              ? 'bg-pink-100 text-pink-800'
              : 'text-gray-700 hover:bg-gray-100'
          }`}
          title={
            snapEnabled
              ? 'Snap on — drag/resize to 5% grid, rotate to 15° increments. Click to disable.'
              : 'Snap off — free-form drag/resize/rotate. Click to enable 5%/15° snapping.'
          }
        >
          <GridFour size={12} weight={snapEnabled ? 'fill' : 'regular'} />
          Snap
        </button>

        {/* Zoom controls — buttons + reset. Cmd/Ctrl+wheel also zooms
            (handler on the stage). Middle-mouse drag pans. */}
        <span className="ml-2 h-4 w-px bg-gray-200" />
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoom <= 0.25}
          className="rounded-md p-1 text-gray-700 hover:bg-gray-100 disabled:opacity-30"
          title="Zoom out (Cmd/Ctrl + scroll wheel)"
        >
          <MagnifyingGlassMinus size={13} weight="bold" />
        </button>
        <button
          type="button"
          onClick={resetView}
          className="rounded px-1 text-[10px] font-mono font-semibold text-gray-700 hover:bg-gray-100"
          title="Reset view (zoom + pan)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoom >= 4}
          className="rounded-md p-1 text-gray-700 hover:bg-gray-100 disabled:opacity-30"
          title="Zoom in (Cmd/Ctrl + scroll wheel)"
        >
          <MagnifyingGlassPlus size={13} weight="bold" />
        </button>

        {variant && (
          <>
            <span className="ml-2 h-4 w-px bg-gray-200" />
            <span className="font-medium text-gray-700">{variant.paletteName}</span>
            <span className="flex">
              {variant.paletteHex.slice(0, 8).map((c, idx) => (
                <span
                  key={`${c}-${idx}`}
                  className="-ml-1 h-4 w-4 rounded-full border-2 border-white first:ml-0"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </span>
            <a
              href={variant.svgUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[10px] font-medium text-gray-500 underline-offset-2 hover:underline"
            >
              Open SVG ↗
            </a>
          </>
        )}
      </div>

      {/* Stage */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-[repeating-linear-gradient(45deg,#f5f5f5_0_10px,#fafafa_10px_20px)]"
        onPointerDown={startPan}
        onWheel={onWheel}
      >
        <div
          ref={stageRef}
          className="relative h-full w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center',
            transition: 'none',
          }}
          onPointerDown={(e) => {
            // Only handle primary button. Skip clicks on overlay
            // handles (those have their own pointer handlers).
            if (e.button !== 0) return
            if ((e.target as HTMLElement)?.closest('[data-selection-overlay]'))
              return
            const geom = getStageGeometry(stageRef.current, viewBoxWidth, viewBoxHeight)
            if (!geom) return
            const startX = e.clientX
            const startY = e.clientY
            const localX = startX - geom.rect.left - geom.contentX
            const localY = startY - geom.rect.top - geom.contentY
            const inContent =
              localX >= 0 && localY >= 0 && localX <= geom.contentW && localY <= geom.contentH
            const normX = inContent ? localX / geom.contentW : -1
            const normY = inContent ? localY / geom.contentH : -1
            const hitId =
              inContent ? hitTestPrimitive(primitives, normX, normY) : null
            const additive = e.shiftKey || e.metaKey || e.ctrlKey

            // If pointerdown is on a primitive, treat as a click on
            // pointerup with no movement check (selection overlay's
            // drag handler is what handles drag-to-move). Otherwise
            // we may either click-empty or box-select.
            let dragMode: 'click' | 'box' = 'click'

            const onMove = (ev: PointerEvent) => {
              const dx = Math.abs(ev.clientX - startX)
              const dy = Math.abs(ev.clientY - startY)
              if (dragMode === 'click' && Math.max(dx, dy) > 3 && !hitId) {
                dragMode = 'box'
              }
              if (dragMode === 'box') {
                setBoxSelect({
                  startX,
                  startY,
                  endX: ev.clientX,
                  endY: ev.clientY,
                })
              }
            }

            const onUp = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)

              if (dragMode === 'click') {
                if (hitId) {
                  onCanvasPrimitiveClick(hitId, { additive })
                } else {
                  onCanvasEmptyClick()
                }
                return
              }

              // Box-select: compute the rect in normalized coords
              // and find all primitives whose bbox intersects.
              const geomNow = getStageGeometry(
                stageRef.current,
                viewBoxWidth,
                viewBoxHeight
              )
              setBoxSelect(null)
              if (!geomNow) return
              const x1 =
                (Math.min(startX, ev.clientX) - geomNow.rect.left - geomNow.contentX) /
                geomNow.contentW
              const y1 =
                (Math.min(startY, ev.clientY) - geomNow.rect.top - geomNow.contentY) /
                geomNow.contentH
              const x2 =
                (Math.max(startX, ev.clientX) - geomNow.rect.left - geomNow.contentX) /
                geomNow.contentW
              const y2 =
                (Math.max(startY, ev.clientY) - geomNow.rect.top - geomNow.contentY) /
                geomNow.contentH

              const hits: string[] = []
              for (const p of primitives) {
                if (p.spec.kind === 'background') continue
                const b = primitiveBoundsNormalized(p.spec)
                if (!b) continue
                // AABB intersection test (any overlap = hit)
                const hit =
                  b.x + b.w >= x1 && b.x <= x2 && b.y + b.h >= y1 && b.y <= y2
                if (hit) hits.push(p.id)
              }
              onBoxSelect({ ids: hits, additive })
            }

            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
        >
          {previewSvg ? (
            <div
              className="h-full w-full p-4 [&_svg]:h-full [&_svg]:w-full [&_svg]:max-h-full [&_svg]:object-contain"
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          ) : hasVector && sourceSvgPending ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-500">Loading variant…</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-4">
              <img
                src={image.image_url}
                alt={image.prompt}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}

          {/* Hover outline — light blue, doesn't interfere with clicks
              (pointer-events-none). Hidden when this is the active
              selection (the pink box already shows the position). */}
          {hoveredPrimitive &&
            previewSvg &&
            hoveredPrimitive.id !== selectedPrimitive?.id && (
              <HoverOutline
                stageRef={stageRef}
                tracked={hoveredPrimitive}
                viewBoxWidth={viewBoxWidth}
                viewBoxHeight={viewBoxHeight}
              />
            )}

          {/* Selection overlay — drag-to-move + corner resize handles
              for the active primitive. Only rendered when there's a
              selected primitive of a movable kind. */}
          {selectedPrimitive && previewSvg && (
            <SelectionOverlay
              stageRef={stageRef}
              tracked={selectedPrimitive}
              viewBoxWidth={viewBoxWidth}
              viewBoxHeight={viewBoxHeight}
              snapEnabled={snapEnabled}
              siblings={primitives.filter((p) => p.id !== selectedPrimitive.id)}
              onChange={(patch) => onPrimitiveChange(selectedPrimitive.id, patch)}
            />
          )}
        </div>

        {/* Rubber-band box-select rectangle. Rendered using fixed
            positioning since the coords are clientX/clientY. */}
        {boxSelect && (
          <div
            className="pointer-events-none fixed border-2 border-blue-400 bg-blue-400/10"
            style={{
              left: Math.min(boxSelect.startX, boxSelect.endX),
              top: Math.min(boxSelect.startY, boxSelect.endY),
              width: Math.abs(boxSelect.endX - boxSelect.startX),
              height: Math.abs(boxSelect.endY - boxSelect.startY),
            }}
          />
        )}
      </div>

      {/* Caption */}
      {image.prompt && (
        <p className="line-clamp-2 px-1 text-xs italic text-gray-500">{image.prompt}</p>
      )}
    </div>
  )
}

// ============================================
// HoverOutline — passive highlight from layer-row hover
// ============================================

function HoverOutline({
  stageRef,
  tracked,
  viewBoxWidth,
  viewBoxHeight,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>
  tracked: TrackedPrimitive
  viewBoxWidth: number
  viewBoxHeight: number
}) {
  const bounds = primitiveBoundsNormalized(tracked.spec)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onResize = () => setTick((t) => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  void tick

  const geom = getStageGeometry(stageRef.current, viewBoxWidth, viewBoxHeight)
  if (!bounds || !geom) {
    // Background primitives have no bbox — render a full-canvas frame
    if (tracked.spec.kind === 'background' && geom) {
      return (
        <div
          className="pointer-events-none absolute border border-blue-400/70"
          style={{
            left: geom.contentX,
            top: geom.contentY,
            width: geom.contentW,
            height: geom.contentH,
          }}
        />
      )
    }
    return null
  }

  const px = geom.contentX + bounds.x * geom.contentW
  const py = geom.contentY + bounds.y * geom.contentH
  const pw = bounds.w * geom.contentW
  const ph = bounds.h * geom.contentH

  const rotate =
    'rotate' in tracked.spec
      ? (tracked.spec as { rotate?: number }).rotate ?? 0
      : 0

  return (
    <div
      className="pointer-events-none absolute border-2 border-blue-400/70"
      style={{
        left: px,
        top: py,
        width: pw,
        height: ph,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        transformOrigin: 'center',
      }}
    />
  )
}

// ============================================
// SelectionOverlay — drag/resize handles
// ============================================

interface SelectionOverlayProps {
  stageRef: React.RefObject<HTMLDivElement | null>
  tracked: TrackedPrimitive
  viewBoxWidth: number
  viewBoxHeight: number
  snapEnabled: boolean
  /** Other primitives — used by smart-guide alignment during drag. */
  siblings: TrackedPrimitive[]
  onChange: (patch: Partial<LayerPrimitive>) => void
}

/**
 * Stage geometry — the SVG content is centered in the stage with
 * `preserveAspectRatio="xMidYMid meet"`, so we mirror that math here
 * to translate between pointer pixel coords and viewBox coords.
 *
 *   stageW × stageH          - the visible drawing area in pixels
 *   contentW × contentH      - the actually-rendered SVG bbox after
 *                              aspect-ratio fitting
 *   contentX, contentY       - the SVG bbox top-left, in stage pixels
 *
 * The container has `p-4` on it, but the inner SVG fills 100% of that
 * remaining space. We measure the inner stageRef so padding doesn't
 * skew the math.
 */
function getStageGeometry(
  stageEl: HTMLDivElement | null,
  viewBoxWidth: number,
  viewBoxHeight: number
): {
  rect: DOMRect
  contentX: number
  contentY: number
  contentW: number
  contentH: number
} | null {
  if (!stageEl) return null
  const rect = stageEl.getBoundingClientRect()
  // The SVG is rendered inside a div with `p-4`. Use the inner SVG
  // element's actual rect when possible — otherwise fall back to the
  // padded container approximation.
  const svgEl = stageEl.querySelector('svg')
  if (svgEl) {
    const svgRect = svgEl.getBoundingClientRect()
    return {
      rect,
      contentX: svgRect.left - rect.left,
      contentY: svgRect.top - rect.top,
      contentW: svgRect.width,
      contentH: svgRect.height,
    }
  }
  // Fallback for the no-SVG case (unused — overlay only renders when
  // previewSvg is set, but kept for safety).
  const padding = 16
  const innerW = rect.width - padding * 2
  const innerH = rect.height - padding * 2
  const aspect = viewBoxWidth / viewBoxHeight
  let contentW: number, contentH: number
  if (innerW / innerH > aspect) {
    contentH = innerH
    contentW = contentH * aspect
  } else {
    contentW = innerW
    contentH = contentW / aspect
  }
  return {
    rect,
    contentX: padding + (innerW - contentW) / 2,
    contentY: padding + (innerH - contentH) / 2,
    contentW,
    contentH,
  }
}

/**
 * The overlay box. Renders dashed border + corner resize handles +
 * (for image) a rotation handle above the box. Pointer events on the
 * body initiate drag-to-move; on a corner initiate resize.
 */
function SelectionOverlay({
  stageRef,
  tracked,
  viewBoxWidth,
  viewBoxHeight,
  snapEnabled,
  siblings,
  onChange,
}: SelectionOverlayProps) {
  // Active smart-guide positions during drag (normalized 0..1).
  // Cleared on pointerup. Rendered as thin lines spanning the canvas.
  const [activeGuides, setActiveGuides] = useState<{
    vert: number | null
    horiz: number | null
  }>({ vert: null, horiz: null })
  const { spec } = tracked
  const bounds = primitiveBoundsNormalized(spec)

  // Force a re-render on resize so handles track the SVG. The actual
  // content size depends on container size + aspect ratio.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onResize = () => setTick((t) => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Stage geometry is read fresh on every render — cheap (just a
  // getBoundingClientRect) and avoids stale-after-resize bugs.
  void tick
  const geom = getStageGeometry(stageRef.current, viewBoxWidth, viewBoxHeight)

  if (!bounds || !geom) return null

  // Convert normalized → pixel coords (relative to stageRef container)
  const px = geom.contentX + bounds.x * geom.contentW
  const py = geom.contentY + bounds.y * geom.contentH
  const pw = bounds.w * geom.contentW
  const ph = bounds.h * geom.contentH

  // Pointer drag — body-of-box → translate. Pointer move deltas are
  // converted to normalized space using the SVG content dimensions.
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const startBounds = bounds
    const startSpec = spec

    const onMove = (ev: PointerEvent) => {
      const dxPx = ev.clientX - startX
      const dyPx = ev.clientY - startY
      let dxN = dxPx / geom.contentW
      let dyN = dyPx / geom.contentH

      // Smart-guide alignment — adjust dx/dy if a sibling's edge,
      // center, or canvas edge is within threshold of one of our
      // own anchors. Skip when snap-to-grid is on (they'd fight).
      if (!snapEnabled && siblings.length > 0) {
        const projected = {
          x: startBounds.x + dxN,
          y: startBounds.y + dyN,
          w: startBounds.w,
          h: startBounds.h,
        }
        const siblingBounds = siblings
          .map((s) => primitiveBoundsNormalized(s.spec))
          .filter((b): b is { x: number; y: number; w: number; h: number } =>
            b !== null
          )
        const align = detectAlignment(projected, siblingBounds)
        dxN += align.xDelta
        dyN += align.yDelta
        setActiveGuides({ vert: align.vertGuide, horiz: align.horizGuide })
      } else {
        setActiveGuides({ vert: null, horiz: null })
      }

      applyMove(startSpec, startBounds, dxN, dyN, snapEnabled, onChange)
    }
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setActiveGuides({ vert: null, horiz: null })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Resize handle — corner determines which edges follow the pointer.
  const startResize =
    (corner: 'nw' | 'ne' | 'sw' | 'se') =>
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startY = e.clientY
      const startBounds = bounds
      const startSpec = spec

      const onMove = (ev: PointerEvent) => {
        const dxN = (ev.clientX - startX) / geom.contentW
        const dyN = (ev.clientY - startY) / geom.contentH
        applyResize(
          startSpec,
          startBounds,
          dxN,
          dyN,
          corner,
          snapEnabled,
          ev.shiftKey,
          onChange
        )
      }
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

  // Rotation handle — works for rect / image / text. Circle is omitted
  // because the result is visually identical to no rotation.
  const startRotate = (e: React.PointerEvent) => {
    if (spec.kind !== 'image' && spec.kind !== 'rect' && spec.kind !== 'text') return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const centerX = geom.rect.left + px + pw / 2
    const centerY = geom.rect.top + py + ph / 2
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI)
    const startRot = (spec as { rotate?: number }).rotate ?? 0

    const onMove = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * (180 / Math.PI)
      let next = startRot + (angle - startAngle)
      next = ((next + 540) % 360) - 180
      // Snap to 15° increments when snap is on
      if (snapEnabled) next = Math.round(next / 15) * 15
      onChange({ rotate: next } as Partial<LayerPrimitive>)
    }
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Don't render handles for kinds we don't support resizing
  const showResizeHandles = spec.kind === 'rect' || spec.kind === 'image' || spec.kind === 'circle'
  const showRotateHandle = spec.kind === 'image' || spec.kind === 'rect' || spec.kind === 'text'

  // The selection box rotates with the primitive when one is set, so
  // the handles visually align with the rotated content.
  const specRotate =
    'rotate' in spec && typeof (spec as { rotate?: number }).rotate === 'number'
      ? (spec as { rotate?: number }).rotate ?? 0
      : 0
  const rotationStyle =
    specRotate
      ? { transform: `rotate(${specRotate}deg)`, transformOrigin: 'center' }
      : undefined

  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-selection-overlay
      // The handles below opt back into pointer events.
    >
      {/* Smart-guide lines — rendered behind the selection box during
          drag when an alignment is detected. */}
      {activeGuides.vert !== null && (
        <div
          className="pointer-events-none absolute bg-pink-400"
          style={{
            left: geom.contentX + activeGuides.vert * geom.contentW - 0.5,
            top: geom.contentY,
            width: 1,
            height: geom.contentH,
          }}
        />
      )}
      {activeGuides.horiz !== null && (
        <div
          className="pointer-events-none absolute bg-pink-400"
          style={{
            left: geom.contentX,
            top: geom.contentY + activeGuides.horiz * geom.contentH - 0.5,
            width: geom.contentW,
            height: 1,
          }}
        />
      )}
      <div
        className="absolute"
        style={{
          left: px,
          top: py,
          width: pw,
          height: ph,
          ...rotationStyle,
        }}
      >
        {/* Body — drag to move */}
        <div
          className="pointer-events-auto absolute inset-0 cursor-move border-2 border-pink-500/80 ring-2 ring-pink-500/20"
          onPointerDown={startDrag}
          title="Drag to move"
        />

        {/* Corner resize handles */}
        {showResizeHandles &&
          (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <div
              key={corner}
              className={`pointer-events-auto absolute h-3 w-3 rounded-sm border-2 border-pink-500 bg-white shadow-sm ${
                corner === 'nw'
                  ? '-left-1.5 -top-1.5 cursor-nwse-resize'
                  : corner === 'ne'
                    ? '-right-1.5 -top-1.5 cursor-nesw-resize'
                    : corner === 'sw'
                      ? '-bottom-1.5 -left-1.5 cursor-nesw-resize'
                      : '-bottom-1.5 -right-1.5 cursor-nwse-resize'
              }`}
              onPointerDown={startResize(corner)}
              title={`Resize ${corner.toUpperCase()}`}
            />
          ))}

        {/* Rotate handle (image only) */}
        {showRotateHandle && (
          <>
            <div className="pointer-events-none absolute -top-7 left-1/2 h-5 w-px -translate-x-1/2 bg-pink-500/60" />
            <div
              className="pointer-events-auto absolute -top-9 left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border-2 border-pink-500 bg-white shadow-sm"
              onPointerDown={startRotate}
              title="Drag to rotate"
            />
          </>
        )}
      </div>
    </div>
  )
}

// ============================================
// Right panel: Properties
// ============================================

interface PropertiesSidebarProps {
  image: GeneratedImage
  hasSelection: boolean
  hasVector: boolean
  selectedLayer: Layer | null
  selectedPrimitive: TrackedPrimitive | null
  isMultiSelect: boolean
  multiSelectionCount: number
  onDeleteSelection: () => void
  onClearSelection: () => void
  onUpdateLayer: (id: string, patch: Partial<Layer>) => void
  onResetLayer: (id: string) => void
  onUpdatePrimitive: (id: string, patch: Partial<LayerPrimitive>) => void
  onReplaceImage: (primitiveId: string) => void
  onImageUpdate: (image: GeneratedImage) => void
  onBranchCreated?: (image: GeneratedImage) => void
  onClose: () => void
  canSaveVariant: boolean
  showSaveFooter: boolean
  saveLabel: string
  variantName: string
  onVariantNameChange: (name: string) => void
  onSaveVariant: () => void
  saving: boolean
  error: string | null
  onErrorClear: () => void
}

function PropertiesSidebar({
  image,
  hasSelection,
  hasVector,
  selectedLayer,
  selectedPrimitive,
  isMultiSelect,
  multiSelectionCount,
  onDeleteSelection,
  onClearSelection,
  onUpdateLayer,
  onResetLayer,
  onUpdatePrimitive,
  onReplaceImage,
  onImageUpdate,
  onBranchCreated,
  onClose,
  canSaveVariant,
  showSaveFooter,
  saveLabel,
  variantName,
  onVariantNameChange,
  onSaveVariant,
  saving,
  error,
  onErrorClear,
}: PropertiesSidebarProps) {
  return (
    <aside className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-sm font-semibold text-gray-900">
          {isMultiSelect
            ? `${multiSelectionCount} layers selected`
            : selectedLayer
              ? 'Layer'
              : selectedPrimitive
                ? primitiveLabel(selectedPrimitive.spec)
                : 'Image'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
          title="Close studio"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={onErrorClear}
              className="rounded p-0.5 hover:bg-red-100"
            >
              <X size={10} />
            </button>
          </div>
        )}

        {isMultiSelect ? (
          <MultiSelectPanel
            count={multiSelectionCount}
            onDelete={onDeleteSelection}
            onClear={onClearSelection}
          />
        ) : selectedLayer ? (
          <LayerPropertiesPanel
            layer={selectedLayer}
            onChange={(patch) => onUpdateLayer(selectedLayer.id, patch)}
            onReset={() => onResetLayer(selectedLayer.id)}
          />
        ) : selectedPrimitive ? (
          <PrimitivePropertiesPanel
            tracked={selectedPrimitive}
            onChange={(patch) => onUpdatePrimitive(selectedPrimitive.id, patch)}
            onReplaceImage={() => onReplaceImage(selectedPrimitive.id)}
          />
        ) : (
          <ImagePropertiesPanel
            image={image}
            onImageUpdate={onImageUpdate}
            onBranchCreated={onBranchCreated}
          />
        )}
      </div>

      {/* Save layered variant — shown when there are layer/primitive
          edits to persist (vector-with-edits OR raster-with-primitives) */}
      {showSaveFooter && (
        <div className="space-y-2 border-t border-gray-100 px-3 py-2">
          <Input
            label="Save as new variant"
            size="sm"
            value={variantName}
            onChange={(e) => onVariantNameChange(e.target.value)}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={onSaveVariant}
            loading={saving}
            disabled={!canSaveVariant}
            icon={<FloppyDisk size={13} weight="bold" />}
            className="w-full"
          >
            {saveLabel}
          </Button>
          {!hasVector && (
            <p className="text-[10px] leading-snug text-gray-500">
              Saves an SVG composition with the original raster as the
              base layer. Subsequent layer edits route through the same
              vector flow.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}

// ===== Multi-select panel (batch actions only) =====

function MultiSelectPanel({
  count,
  onDelete,
  onClear,
}: {
  count: number
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div className="space-y-3 text-sm text-gray-700">
      <p className="text-[11px] leading-relaxed text-gray-600">
        {count} items selected. Per-layer property edits are disabled while
        multiple layers are selected — pick one to tweak its individual
        properties. The actions below apply to the whole selection.
      </p>
      <div className="space-y-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          icon={<Trash size={12} weight="bold" />}
          className="w-full"
        >
          Delete {count} layers
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="w-full"
        >
          Clear selection
        </Button>
      </div>
      <p className="text-[10px] text-gray-500">
        Tip: shift-click or ⌘-click in the layers panel to add/remove
        items from the selection. ⌫ deletes everything selected.
      </p>
    </div>
  )
}

// ===== Layer-level properties (traced color bands) =====

function LayerPropertiesPanel({
  layer,
  onChange,
  onReset,
}: {
  layer: Layer
  onChange: (patch: Partial<Layer>) => void
  onReset: () => void
}) {
  const finalColor = effectiveColor(layer)
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ColorSwatchInput
          value={layer.color}
          swatchPreview={finalColor}
          onChange={(next) => onChange({ color: next })}
        />
        <button
          type="button"
          onClick={onReset}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-gray-400"
        >
          <ArrowCounterClockwise size={10} weight="bold" />
          Reset
        </button>
      </div>

      <div className="space-y-2 text-[10px] text-gray-700">
        <SliderControl
          label="Opacity"
          value={layer.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onChange({ opacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderControl
          label="Warm ↔ cool"
          value={layer.colorAdjust.hueShift}
          min={-90}
          max={90}
          step={5}
          onChange={(v) =>
            onChange({ colorAdjust: { ...layer.colorAdjust, hueShift: v } })
          }
          format={(v) =>
            v > 0 ? `cool ${v}°` : v < 0 ? `warm ${Math.abs(v)}°` : 'neutral'
          }
        />
        <SliderControl
          label="Shadow ↔ highlight"
          value={layer.colorAdjust.lightnessDelta}
          min={-0.4}
          max={0.4}
          step={0.05}
          onChange={(v) =>
            onChange({ colorAdjust: { ...layer.colorAdjust, lightnessDelta: v } })
          }
          format={(v) =>
            v > 0 ? `+${Math.round(v * 100)}%` : v < 0 ? `${Math.round(v * 100)}%` : '0'
          }
        />
        <SliderControl
          label="Saturation"
          value={layer.colorAdjust.saturationDelta}
          min={-0.5}
          max={0.5}
          step={0.05}
          onChange={(v) =>
            onChange({ colorAdjust: { ...layer.colorAdjust, saturationDelta: v } })
          }
          format={(v) =>
            v > 0 ? `+${Math.round(v * 100)}%` : v < 0 ? `${Math.round(v * 100)}%` : '0'
          }
        />
      </div>

      <div className="rounded-md bg-gray-50 p-2 text-[10px] text-gray-500">
        {layer.pathCount} paths · {(layer.weight * 100).toFixed(1)}% of total area
      </div>
    </div>
  )
}

// ===== Primitive-level properties (added shapes) =====

function PrimitivePropertiesPanel({
  tracked,
  onChange,
  onReplaceImage,
}: {
  tracked: TrackedPrimitive
  onChange: (patch: Partial<LayerPrimitive>) => void
  onReplaceImage: () => void
}) {
  const { spec } = tracked
  const isImage = spec.kind === 'image'
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {isImage ? (
          <div className="flex items-center gap-2">
            <div
              className="h-12 w-12 overflow-hidden rounded-md border border-gray-300 bg-[repeating-linear-gradient(45deg,#f5f5f5_0_6px,#fafafa_6px_12px)]"
            >
              {spec.url && (
                <img
                  src={spec.url}
                  alt="layer source"
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onReplaceImage}
              icon={<MagnifyingGlass size={11} weight="bold" />}
            >
              Replace
            </Button>
          </div>
        ) : (
          <ColorSwatchInput
            value={spec.color}
            onChange={(next) => onChange({ color: next })}
          />
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-500">
          {primitiveLabel(spec)}
        </span>
      </div>

      {spec.kind === 'background' && (
        <SliderControl
          label="Opacity"
          value={spec.opacity ?? 1}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onChange({ opacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      )}

      {spec.kind === 'rect' && (
        <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-700">
          <SliderControl
            label="X"
            value={spec.x}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ x: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Y"
            value={spec.y}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ y: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Width"
            value={spec.width}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ width: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Height"
            value={spec.height}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ height: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Corner radius"
            value={spec.cornerRadius ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ cornerRadius: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Rotate"
            value={spec.rotate ?? 0}
            min={-180}
            max={180}
            step={5}
            onChange={(v) => onChange({ rotate: v })}
            format={(v) => `${Math.round(v)}°`}
          />
          <SliderControl
            label="Opacity"
            value={spec.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ opacity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      )}

      {spec.kind === 'circle' && (
        <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-700">
          <SliderControl
            label="Center X"
            value={spec.cx}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ cx: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Center Y"
            value={spec.cy}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ cy: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Radius"
            value={spec.r}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ r: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Opacity"
            value={spec.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ opacity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      )}

      {spec.kind === 'image' && (
        <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-700">
          <SliderControl
            label="X"
            value={spec.x}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ x: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Y"
            value={spec.y}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ y: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Width"
            value={spec.width}
            min={0.05}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ width: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Height"
            value={spec.height}
            min={0.05}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ height: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Rotate"
            value={spec.rotate ?? 0}
            min={-180}
            max={180}
            step={5}
            onChange={(v) => onChange({ rotate: v })}
            format={(v) => `${Math.round(v)}°`}
          />
          <SliderControl
            label="Opacity"
            value={spec.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ opacity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      )}

      {spec.kind === 'text' && (
        <div className="space-y-2">
          <Input
            value={spec.content}
            onChange={(e) => onChange({ content: e.target.value })}
            label="Text"
            placeholder="Layer text"
            size="sm"
          />
          <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-700">
            <SliderControl
              label="X"
              value={spec.x}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onChange({ x: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderControl
              label="Y"
              value={spec.y}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onChange({ y: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderControl
              label="Size"
              value={spec.size}
              min={0.02}
              max={0.5}
              step={0.01}
              onChange={(v) => onChange({ size: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderControl
              label="Rotate"
              value={spec.rotate ?? 0}
              min={-180}
              max={180}
              step={5}
              onChange={(v) => onChange({ rotate: v })}
              format={(v) => `${Math.round(v)}°`}
            />
            <SliderControl
              label="Opacity"
              value={spec.opacity ?? 1}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onChange({ opacity: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-700">
            <label className="flex flex-col gap-0.5">
              <span className="font-medium">Weight</span>
              <select
                value={spec.fontWeight ?? 'normal'}
                onChange={(e) =>
                  onChange({ fontWeight: e.target.value as 'normal' | 'bold' })
                }
                className="rounded border border-gray-200 px-1.5 py-1 text-[11px]"
              >
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-medium">Anchor</span>
              <select
                value={spec.anchor ?? 'start'}
                onChange={(e) =>
                  onChange({ anchor: e.target.value as 'start' | 'middle' | 'end' })
                }
                className="rounded border border-gray-200 px-1.5 py-1 text-[11px]"
              >
                <option value="start">Left</option>
                <option value="middle">Center</option>
                <option value="end">Right</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

// ===== Image-level properties (no selection) =====

function ImagePropertiesPanel({
  image,
  onImageUpdate,
  onBranchCreated,
}: {
  image: GeneratedImage
  onImageUpdate: (image: GeneratedImage) => void
  onBranchCreated?: (image: GeneratedImage) => void
}) {
  const [instruction, setInstruction] = useState('')
  const [model, setModel] = useState<ModelKey>('flash')
  const [loading, setLoading] = useState(false)
  const [maskMode, setMaskMode] = useState(false)
  const [maskBase64, setMaskBase64] = useState<string | null>(null)
  const [saveAsNew, setSaveAsNew] = useState(false)
  const [restoringIndex, setRestoringIndex] = useState<number | null>(null)
  const [forkingIndex, setForkingIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const modelOptions = MODEL_OPTIONS.map((m) => ({
    value: m.key,
    label: m.label,
  }))

  const applyEdit = async () => {
    if (!instruction.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/art-generator/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageId: image.id,
          instruction: instruction.trim(),
          model,
          ...(maskMode && maskBase64 ? { maskBase64 } : {}),
          ...(saveAsNew ? { saveAsNew: true } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to apply edit')
      }
      const json = (await res.json()) as Partial<{
        image: GeneratedImage
        branched: boolean
      }> &
        Partial<GeneratedImage>
      const updated = (json.image ?? (json as GeneratedImage)) as GeneratedImage
      const branched = Boolean(json.branched)
      setInstruction('')
      if (branched && onBranchCreated) {
        onBranchCreated(updated)
      } else {
        onImageUpdate(updated)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const fork = async (fromEditIndex: number | null) => {
    setForkingIndex(fromEditIndex ?? -1)
    setError(null)
    try {
      const res = await fetch(`/api/art-generator/${image.id}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(typeof fromEditIndex === 'number' ? { fromEditIndex } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Fork failed (${res.status})`)
      }
      const { image: forked } = (await res.json()) as { image: GeneratedImage }
      if (onBranchCreated) {
        onBranchCreated(forked)
      } else {
        onImageUpdate(forked)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fork failed')
    } finally {
      setForkingIndex(null)
    }
  }

  const restore = async (index: number) => {
    if (
      !window.confirm(
        `Roll back to before edit #${index + 1}? All edits after that will be removed from history.`
      )
    ) {
      return
    }
    setRestoringIndex(index)
    setError(null)
    try {
      const res = await fetch(`/api/art-generator/${image.id}/restore-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edit_index: index }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Restore failed (${res.status})`)
      }
      const { image: updated } = (await res.json()) as { image: GeneratedImage }
      onImageUpdate(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoringIndex(null)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Mask mode toggle */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMaskMode(false)
            setMaskBase64(null)
          }}
          className={`rounded-md px-2 py-1 text-[11px] font-medium ${
            !maskMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Whole image
        </button>
        <button
          type="button"
          onClick={() => setMaskMode(true)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
            maskMode ? 'bg-pink-100 text-pink-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Selection size={11} weight={maskMode ? 'fill' : 'regular'} />
          Mask region
        </button>
        {maskMode && maskBase64 && (
          <span className="text-[10px] text-pink-700">Mask ready</span>
        )}
      </div>

      {/* Mask brush */}
      {maskMode && (
        <div className="rounded-md border border-gray-200 p-2">
          <MaskBrush imageUrl={image.image_url} onMaskReady={setMaskBase64} />
        </div>
      )}

      <Textarea
        label="Edit instruction"
        placeholder="Describe what to change…"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
      />

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Quick templates
        </p>
        <div className="flex flex-wrap gap-1">
          {EDIT_TEMPLATES.map((tpl) => (
            <button
              key={tpl.label}
              type="button"
              onClick={() => setInstruction(tpl.instruction)}
              className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
              title={tpl.instruction}
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      <Select
        label="Model"
        options={modelOptions}
        value={model}
        onChange={(e) => setModel(e.target.value as ModelKey)}
      />

      <label
        className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-[11px] ${
          saveAsNew
            ? 'border-pink-300 bg-pink-50 text-pink-900'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <input
          type="checkbox"
          className="mt-0.5 accent-pink-500"
          checked={saveAsNew}
          onChange={(e) => setSaveAsNew(e.target.checked)}
        />
        <span className="flex-1">
          <span className="flex items-center gap-1 font-medium">
            <Copy size={11} weight="bold" />
            Save as new copy
          </span>
          <span className="mt-0.5 block text-[10px] text-gray-500">
            Keeps the original and creates a sibling with the edit applied.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="primary"
          size="sm"
          onClick={applyEdit}
          loading={loading}
          disabled={!instruction.trim()}
          icon={<PaperPlaneRight size={13} />}
        >
          {saveAsNew ? 'Apply as new' : 'Apply Edit'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fork(null)}
          disabled={loading || forkingIndex !== null}
          loading={forkingIndex === -1}
          icon={<GitBranch size={12} weight="bold" />}
          title="Fork the current image into a new sibling"
        >
          Fork
        </Button>
      </div>

      {/* Edit history */}
      {image.edit_history && image.edit_history.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-100 pt-3">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            <ClockCounterClockwise size={11} />
            History ({image.edit_history.length})
          </p>
          <ul className="space-y-1.5">
            {image.edit_history.map((entry, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-[11px]"
              >
                {entry.previousImageUrl && (
                  <img
                    src={entry.previousImageUrl}
                    alt={`Before edit ${i + 1}`}
                    className="h-9 w-9 flex-shrink-0 rounded border border-gray-200 object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-gray-800">{entry.instruction}</p>
                  <p className="mt-0.5 text-[9px] text-gray-400">
                    {new Date(entry.timestamp).toLocaleString()} · {entry.model}
                  </p>
                </div>
                {entry.previousImageUrl && (
                  <div className="flex flex-shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => restore(i)}
                      disabled={restoringIndex !== null || forkingIndex !== null || loading}
                      className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
                      title="Restore to before this edit"
                    >
                      {restoringIndex === i ? '…' : (
                        <span className="inline-flex items-center gap-0.5">
                          <ArrowCounterClockwise size={9} weight="bold" />
                          Restore
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => fork(i)}
                      disabled={restoringIndex !== null || forkingIndex !== null || loading}
                      className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-gray-700 hover:border-pink-300 hover:text-pink-700 disabled:opacity-50"
                      title="Fork from this point"
                    >
                      {forkingIndex === i ? '…' : (
                        <span className="inline-flex items-center gap-0.5">
                          <GitBranch size={9} weight="bold" />
                          Fork
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ============================================
// Helpers
// ============================================

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format?: (value: number) => string
}

/**
 * Color picker swatch + editable hex input. Click the swatch to open
 * the native color picker; type a hex into the text field to set
 * directly. Both flows commit through the same onChange.
 *
 * Hex parsing tolerates input with or without `#`, supports 3- and
 * 6-digit forms. Invalid input is just left on the field — onChange
 * only fires when a valid 3/6-digit hex is typed.
 */
function ColorSwatchInput({
  value,
  swatchPreview,
  onChange,
  size = 'md',
}: {
  /** The canonical color (hex, lowercase or upper). Used as both the
   *  text input value and the native color picker value. */
  value: string
  /** Optional preview color — for traced layers, the swatch shows
   *  the post-adjust color while the hex input shows the user-set base. */
  swatchPreview?: string
  onChange: (next: string) => void
  size?: 'sm' | 'md'
}) {
  const [draft, setDraft] = useState(value)
  // Keep the draft in sync when the value changes from outside (eg.
  // operator picks via native color picker, or undo/redo).
  useEffect(() => {
    setDraft(value)
  }, [value])

  const swatchSize = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'

  const tryCommit = (raw: string) => {
    let v = raw.trim().toLowerCase()
    if (!v.startsWith('#')) v = '#' + v
    // Expand 3-digit hex
    if (/^#[0-9a-f]{3}$/.test(v)) {
      v = '#' + v.slice(1).split('').map((c) => c + c).join('')
    }
    if (/^#[0-9a-f]{6}$/.test(v)) {
      onChange(v)
      setDraft(v)
    }
  }

  return (
    <label className="flex cursor-pointer items-center gap-2">
      <span
        className={`${swatchSize} rounded-md border border-gray-300 transition-colors`}
        style={{ backgroundColor: swatchPreview ?? value }}
      />
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => tryCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            tryCommit(draft)
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            setDraft(value)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        onClick={(e) => e.stopPropagation()}
        spellCheck={false}
        className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] text-gray-700 hover:border-gray-200 focus:border-gray-400 focus:bg-white focus:outline-none"
        title="Type a hex color (e.g. #1e293b) and press Enter"
      />
    </label>
  )
}

function SliderControl({ label, value, min, max, step, onChange, format }: SliderControlProps) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-gray-500">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-pink-500"
      />
    </label>
  )
}

// ============================================
// Image picker modal — gallery + generate-new
// ============================================

interface ImagePickerModalProps {
  excludeImageId: string
  defaultStylePackId?: string
  defaultTopicId?: string | null
  defaultAspectRatio?: AspectRatioKey
  /** Seeds the "Generate new" textarea — usually the parent piece's
   *  prompt so the operator can tweak it instead of starting blank. */
  defaultPromptSeed?: string
  onPick: (picked: { url: string; sourceImageId?: string; label?: string }) => void
  onClose: () => void
}

function ImagePickerModal({
  excludeImageId,
  defaultStylePackId = '',
  defaultTopicId = null,
  defaultAspectRatio = '1:1',
  defaultPromptSeed = '',
  onPick,
  onClose,
}: ImagePickerModalProps) {
  const [tab, setTab] = useState<'gallery' | 'generate'>('gallery')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[680px] w-[760px] max-w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Pick an image to add as a layer
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex border-b border-gray-100 px-4">
          <PickerTab
            active={tab === 'gallery'}
            onClick={() => setTab('gallery')}
            label="From gallery"
          />
          <PickerTab
            active={tab === 'generate'}
            onClick={() => setTab('generate')}
            label="Generate new"
          />
        </div>

        <div className="flex-1 overflow-hidden">
          {tab === 'gallery' && (
            <PickerGalleryTab excludeImageId={excludeImageId} onPick={onPick} />
          )}
          {tab === 'generate' && (
            <PickerGenerateTab
              defaultStylePackId={defaultStylePackId}
              defaultTopicId={defaultTopicId}
              defaultAspectRatio={defaultAspectRatio}
              defaultPromptSeed={defaultPromptSeed}
              onPick={onPick}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function PickerTab({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-2 text-xs font-medium transition-colors ${
        active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'
      }`}
    >
      {label}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-pink-500" />
      )}
    </button>
  )
}

function PickerGalleryTab({
  excludeImageId,
  onPick,
}: {
  excludeImageId: string
  onPick: (picked: { url: string; sourceImageId?: string; label?: string }) => void
}) {
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/art-generator?limit=100')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as { images?: GeneratedImage[] }
      })
      .then((data) => {
        if (cancelled) return
        setImages((data.images ?? []).filter((img) => img.id !== excludeImageId))
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load gallery')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [excludeImageId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return images
    return images.filter((img) => img.prompt.toLowerCase().includes(q))
  }, [images, search])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-100 px-4 py-2">
        <Input
          size="sm"
          placeholder="Filter by prompt…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </div>
        )}
        {loading ? (
          <p className="py-6 text-center text-sm text-gray-500">Loading gallery…</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No images match. Try generating a new one in the next tab.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
            {filtered.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() =>
                  onPick({
                    url: img.image_url,
                    sourceImageId: img.id,
                    label: img.prompt.slice(0, 32),
                  })
                }
                className="group flex flex-col gap-1 overflow-hidden rounded-md border border-gray-200 bg-white text-left transition-colors hover:border-pink-300"
              >
                <div className="aspect-square overflow-hidden bg-[repeating-linear-gradient(45deg,#f5f5f5_0_8px,#fafafa_8px_16px)]">
                  <img
                    src={img.image_url}
                    alt={img.prompt}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                </div>
                <p className="line-clamp-2 px-1.5 pb-1 text-[10px] text-gray-700">
                  {img.prompt}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PickerGenerateTab({
  defaultStylePackId,
  defaultTopicId,
  defaultAspectRatio,
  defaultPromptSeed,
  onPick,
}: {
  defaultStylePackId: string
  defaultTopicId: string | null
  defaultAspectRatio: AspectRatioKey
  defaultPromptSeed: string
  onPick: (picked: { url: string; sourceImageId?: string; label?: string }) => void
}) {
  const [prompt, setPrompt] = useState(defaultPromptSeed)
  const [stylePackId, setStylePackId] = useState(defaultStylePackId)
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>(defaultAspectRatio)
  const [model, setModel] = useState<ModelKey>('flash')
  const [useTopicContext, setUseTopicContext] = useState(Boolean(defaultTopicId))
  const [topicContextStatus, setTopicContextStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error' | 'none'
  >(defaultTopicId ? 'idle' : 'none')
  const [topicContext, setTopicContext] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-fetch contribution context for the parent piece's topic so we
  // can pass it into the generate call. Same source the main prompt
  // builder uses; the generated layer will feel coherent.
  useEffect(() => {
    if (!defaultTopicId) {
      setTopicContextStatus('none')
      return
    }
    let cancelled = false
    setTopicContextStatus('loading')
    fetch(`/api/topics/${defaultTopicId}/contributions?limit=10`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as {
          contributions: Array<{
            contributor_name: string
            contributor_location: string | null
            type: string
            content: string
            caption: string | null
          }>
        }
      })
      .then((data) => {
        if (cancelled) return
        const lines = data.contributions
          .slice(0, 5)
          .map((c) => {
            const where = c.contributor_location ? ` (${c.contributor_location})` : ''
            const text = c.type === 'story' ? c.content : c.caption ?? ''
            return `${c.contributor_name}${where}: "${(text ?? '').trim().slice(0, 200)}"`
          })
        const formatted = lines.join('\n')
        setTopicContext(formatted)
        setTopicContextStatus(formatted ? 'ready' : 'none')
      })
      .catch(() => {
        if (cancelled) return
        setTopicContextStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [defaultTopicId])

  const stylePacks = useMemo(() => listLaunchStylePacks(), [])
  const stylePackOptions = [
    { value: '', label: 'No artist (free style)' },
    ...stylePacks.map((p) => ({
      value: p.id,
      label: `${p.persona.name} — ${p.persona.tagline}`,
    })),
  ]
  const aspectOptions = [
    { value: '1:1', label: 'Square' },
    { value: '3:4', label: 'Portrait' },
    { value: '4:3', label: 'Landscape' },
  ]
  const modelOptions = MODEL_OPTIONS.map((m) => ({ value: m.key, label: m.label }))

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setGenerating(true)
    setError(null)
    try {
      const params: GenerateParams & {
        contributionContext?: string
        topicId?: string
      } = {
        prompt: prompt.trim(),
        model,
        aspectRatio,
        ...(stylePackId ? { stylePackId } : {}),
        ...(defaultTopicId ? { topicId: defaultTopicId } : {}),
        ...(useTopicContext && topicContext ? { contributionContext: topicContext } : {}),
      }
      const res = await fetch('/api/art-generator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Generation failed (${res.status})`)
      }
      const json = (await res.json()) as { image?: GeneratedImage } & GeneratedImage
      const generated = json.image ?? (json as GeneratedImage)
      onPick({
        url: generated.image_url,
        sourceImageId: generated.id,
        label: generated.prompt.slice(0, 32),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}
      <p className="text-xs text-gray-600">
        Generate a fresh image and add it as a layer in one shot. The new image
        is saved to your gallery so you can reuse it later.
      </p>
      <Textarea
        label="Prompt"
        rows={3}
        placeholder="Describe what you want to layer in…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      {topicContextStatus !== 'none' && (
        <label
          className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-[11px] ${
            useTopicContext
              ? 'border-pink-300 bg-pink-50 text-pink-900'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5 accent-pink-500"
            checked={useTopicContext}
            onChange={(e) => setUseTopicContext(e.target.checked)}
            disabled={topicContextStatus === 'loading' || topicContextStatus === 'error'}
          />
          <span className="flex-1">
            <span className="block font-medium">Pull in topic context</span>
            <span className="mt-0.5 block text-[10px] text-gray-500">
              {topicContextStatus === 'loading'
                ? 'Loading contribution context…'
                : topicContextStatus === 'ready'
                  ? `Adds the parent piece's topic contributions to the prompt for coherence (${
                      topicContext.split('\n').filter(Boolean).length
                    } contributions).`
                  : topicContextStatus === 'error'
                    ? 'Could not load contribution context — disable this and try again.'
                    : ''}
            </span>
          </span>
        </label>
      )}
      <Select
        label="Artist (style pack)"
        options={stylePackOptions}
        value={stylePackId}
        onChange={(e) => setStylePackId(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Aspect"
          options={aspectOptions}
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value as AspectRatioKey)}
        />
        <Select
          label="Model"
          options={modelOptions}
          value={model}
          onChange={(e) => setModel(e.target.value as ModelKey)}
        />
      </div>
      <div className="mt-1 flex">
        <Button
          variant="primary"
          onClick={handleGenerate}
          loading={generating}
          disabled={!prompt.trim()}
          icon={<Lightning size={14} weight="bold" />}
        >
          Generate &amp; add as layer
        </Button>
      </div>
      <p className="text-[10px] text-gray-500">
        Generation typically takes ~10s for the Fast model and ~20s for the
        Pro model.
      </p>
    </div>
  )
}

