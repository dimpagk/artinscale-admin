'use client'

import { useState, useEffect, useMemo } from 'react'
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
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  applyLayers,
  appendPrimitive,
  effectiveColor,
  parseLayers,
  type Layer,
  type LayerPrimitive,
} from '@/lib/svg-layers'
import { defaultPrimitiveSpec } from '@/lib/svg-primitives'

/**
 * Layer panel for an SVG variant.
 *
 * Loads the variant's SVG, parses it into color-band layers, lets the
 * operator:
 *   - Toggle visibility per layer
 *   - Recolor a layer (direct hex picker)
 *   - Tune the color: warm↔cool, lighter↔darker, more↔less saturated
 *   - Set opacity per layer
 *
 * Live preview re-renders the SVG with the current layer state. When
 * the operator clicks "Save as new variant", the edited SVG is sent
 * to the edit-svg-layers endpoint and persisted as a new variant.
 *
 * Move / scale / rotate per layer is documented as a follow-up — needs
 * SVG viewBox + transform-origin handling that the current pure-text
 * approach doesn't cover safely.
 */

interface LayerPanelProps {
  imageId: string
  variantIndex: number
  variantName: string
  svgUrl: string
  onSaved: (updated: { vector: unknown; image: unknown }) => void
  onClose: () => void
}

/**
 * One added primitive in operator state — wraps the LayerPrimitive
 * with a stable id so the UI can render a delete button per item
 * without relying on array index (which shifts on reorder/removal).
 */
interface TrackedPrimitive {
  id: string
  spec: LayerPrimitive
}

export function LayerPanel({
  imageId,
  variantIndex,
  variantName,
  svgUrl,
  onSaved,
  onClose,
}: LayerPanelProps) {
  const [sourceSvg, setSourceSvg] = useState<string | null>(null)
  const [layers, setLayers] = useState<Layer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(`${variantName} — edit`)
  const [primitives, setPrimitives] = useState<TrackedPrimitive[]>([])

  // Load + parse on mount / when SVG changes
  useEffect(() => {
    let cancelled = false
    setSourceSvg(null)
    setLayers([])
    setError(null)
    fetch(svgUrl)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then((svg) => {
        if (cancelled) return
        setSourceSvg(svg)
        setLayers(parseLayers(svg))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load SVG')
      })
    return () => {
      cancelled = true
    }
  }, [svgUrl])

  // Build the live-preview SVG: apply layer edits, then stack any
  // operator-added primitives on top (or behind, for backgrounds).
  const previewSvg = useMemo(() => {
    if (!sourceSvg) return null
    let svg = applyLayers(sourceSvg, layers)
    for (const p of primitives) {
      const result = appendPrimitive(svg, p.spec, { id: p.id })
      svg = result.svg
    }
    return svg
  }, [sourceSvg, layers, primitives])

  const updateLayer = (id: string, patch: Partial<Layer>) => {
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
  }

  const resetLayer = (id: string) => {
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
  }

  // ============================================
  // Add-layer helpers
  // ============================================

  const newPrimitiveId = () =>
    `added-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

  const handleAddPrimitive = (kind: LayerPrimitive['kind']) => {
    setPrimitives((prev) => [
      ...prev,
      { id: newPrimitiveId(), spec: defaultPrimitiveSpec(kind) },
    ])
  }

  const updatePrimitive = (id: string, patch: Partial<LayerPrimitive>) => {
    setPrimitives((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        // Only merge fields valid for this primitive kind. The Partial
        // type is intentionally loose because the controls share a
        // change handler — guard against shape drift here.
        return { ...p, spec: { ...p.spec, ...patch } as LayerPrimitive }
      })
    )
  }

  const removePrimitive = (id: string) => {
    setPrimitives((prev) => prev.filter((p) => p.id !== id))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/art-generator/${imageId}/edit-svg-layers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variant_index: variantIndex,
          layers,
          primitives: primitives.map((p) => p.spec),
          name: name.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Save failed (${res.status})`)
      }
      const result = (await res.json()) as { vector: unknown; image: unknown }
      onSaved(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Edit layers — {variantName}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Close
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {!sourceSvg ? (
        <p className="py-6 text-center text-sm text-gray-500">Loading layers…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
          {/* Live preview */}
          <div className="space-y-2">
            <div className="aspect-square overflow-hidden rounded-md border border-gray-200 bg-[repeating-linear-gradient(45deg,#f5f5f5_0_8px,#fafafa_8px_16px)]">
              {previewSvg && (
                <div
                  className="h-full w-full [&_svg]:h-full [&_svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: previewSvg }}
                />
              )}
            </div>
            <p className="text-xs text-gray-500">
              {layers.filter((l) => l.visible).length} of {layers.length} layers visible
            </p>
          </div>

          {/* Layer controls */}
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {layers.map((layer) => {
              const finalColor = effectiveColor(layer)
              return (
                <div
                  key={layer.id}
                  className={`space-y-2 rounded-md border p-3 ${
                    layer.visible ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'
                  }`}
                >
                  {/* Header: visibility + color + reset */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                      className="rounded p-1 text-gray-700 hover:bg-gray-100"
                      title={layer.visible ? 'Hide layer' : 'Show layer'}
                    >
                      {layer.visible ? <Eye size={16} weight="duotone" /> : <EyeSlash size={16} weight="duotone" />}
                    </button>

                    <label className="flex cursor-pointer items-center gap-1.5">
                      <span
                        className="h-7 w-7 rounded-full border border-gray-300"
                        style={{ backgroundColor: finalColor }}
                      />
                      <input
                        type="color"
                        value={layer.color}
                        onChange={(e) => updateLayer(layer.id, { color: e.target.value })}
                        className="sr-only"
                      />
                      <span className="font-mono text-xs text-gray-700">{finalColor}</span>
                    </label>

                    <span className="ml-auto text-[10px] text-gray-400">
                      {(layer.weight * 100).toFixed(0)}% · {layer.pathCount} paths
                    </span>

                    <button
                      type="button"
                      onClick={() => resetLayer(layer.id)}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100"
                      title="Reset this layer"
                    >
                      <ArrowCounterClockwise size={12} />
                    </button>
                  </div>

                  {/* Sliders: opacity, warmth, lightness, saturation */}
                  <div className="grid grid-cols-2 gap-2">
                    <SliderControl
                      label="Opacity"
                      value={layer.opacity}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => updateLayer(layer.id, { opacity: v })}
                      format={(v) => `${Math.round(v * 100)}%`}
                    />
                    <SliderControl
                      label="Warm ↔ cool"
                      value={layer.colorAdjust.hueShift}
                      min={-90}
                      max={90}
                      step={5}
                      onChange={(v) => updateLayer(layer.id, { colorAdjust: { ...layer.colorAdjust, hueShift: v } })}
                      format={(v) => (v > 0 ? `cool ${v}°` : v < 0 ? `warm ${Math.abs(v)}°` : 'neutral')}
                    />
                    <SliderControl
                      label="Shadow ↔ highlight"
                      value={layer.colorAdjust.lightnessDelta}
                      min={-0.4}
                      max={0.4}
                      step={0.05}
                      onChange={(v) =>
                        updateLayer(layer.id, { colorAdjust: { ...layer.colorAdjust, lightnessDelta: v } })
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
                        updateLayer(layer.id, { colorAdjust: { ...layer.colorAdjust, saturationDelta: v } })
                      }
                      format={(v) =>
                        v > 0 ? `+${Math.round(v * 100)}%` : v < 0 ? `${Math.round(v * 100)}%` : '0'
                      }
                    />
                  </div>
                </div>
              )
            })}

            {/* Operator-added primitives — show beneath the parsed layers */}
            {primitives.length > 0 && (
              <div className="mt-2 space-y-3 border-t border-dashed border-gray-200 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Added layers
                </p>
                {primitives.map((p) => (
                  <PrimitiveControls
                    key={p.id}
                    tracked={p}
                    onUpdate={(patch) => updatePrimitive(p.id, patch)}
                    onRemove={() => removePrimitive(p.id)}
                  />
                ))}
              </div>
            )}

            {/* Add layer controls */}
            <div className="mt-2 space-y-2 border-t border-dashed border-gray-200 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Add a new layer
              </p>
              <div className="flex flex-wrap gap-1.5">
                <AddLayerButton
                  onClick={() => handleAddPrimitive('background')}
                  icon={<PaintBucket size={12} weight="bold" />}
                  label="Background"
                />
                <AddLayerButton
                  onClick={() => handleAddPrimitive('rect')}
                  icon={<Square size={12} weight="bold" />}
                  label="Rectangle"
                />
                <AddLayerButton
                  onClick={() => handleAddPrimitive('circle')}
                  icon={<CircleIcon size={12} weight="bold" />}
                  label="Circle"
                />
                <AddLayerButton
                  onClick={() => handleAddPrimitive('text')}
                  icon={<TextAa size={12} weight="bold" />}
                  label="Text"
                />
              </div>
              <p className="text-[10px] text-gray-400">
                Background sits behind the artwork. Rectangle, circle, and text paint on top — adjust position and size after adding.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
        <div className="min-w-[260px] flex-1">
          <Input
            label="Save as new variant"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="sm"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          loading={saving}
          icon={<FloppyDisk size={14} weight="bold" />}
        >
          Save variant
        </Button>
      </div>
    </div>
  )
}

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format?: (value: number) => string
}

function SliderControl({ label, value, min, max, step, onChange, format }: SliderControlProps) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-gray-700">
      <span className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-gray-500">{format ? format(value) : value.toFixed(2)}</span>
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

interface AddLayerButtonProps {
  onClick: () => void
  icon: React.ReactNode
  label: string
}

function AddLayerButton({ onClick, icon, label }: AddLayerButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
    >
      <Plus size={10} weight="bold" />
      {icon}
      {label}
    </button>
  )
}

interface PrimitiveControlsProps {
  tracked: TrackedPrimitive
  onUpdate: (patch: Partial<LayerPrimitive>) => void
  onRemove: () => void
}

/**
 * Per-primitive control rendered in the operator's "Added layers"
 * list. Each kind has its own knobs:
 *   - background: color + opacity
 *   - rect: color, x, y, width, height, opacity, corner radius
 *   - circle: color, cx, cy, r, opacity
 *   - text: color, content, x, y, size, weight, anchor, opacity
 */
function PrimitiveControls({ tracked, onUpdate, onRemove }: PrimitiveControlsProps) {
  const { spec } = tracked
  const kindLabel: Record<LayerPrimitive['kind'], string> = {
    background: 'Background fill',
    rect: 'Rectangle',
    circle: 'Circle',
    text: 'Text',
    image: 'Image',
  }
  const kindIcon: Record<LayerPrimitive['kind'], React.ReactElement> = {
    background: <PaintBucket size={12} weight="bold" />,
    rect: <Square size={12} weight="bold" />,
    circle: <CircleIcon size={12} weight="bold" />,
    text: <TextAa size={12} weight="bold" />,
    image: <ImageIcon size={12} weight="bold" />,
  }

  return (
    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-700">
          {kindIcon[spec.kind]}
          {kindLabel[spec.kind]}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <span
            className="h-6 w-6 rounded-full border border-gray-300"
            style={{ backgroundColor: spec.color }}
          />
          <input
            type="color"
            value={spec.color}
            onChange={(e) => onUpdate({ color: e.target.value })}
            className="sr-only"
          />
          <span className="font-mono text-[10px] text-gray-700">{spec.color}</span>
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
          title="Remove this layer"
        >
          <Trash size={12} />
        </button>
      </div>

      {/* Per-kind controls */}
      {spec.kind === 'background' && (
        <SliderControl
          label="Opacity"
          value={spec.opacity ?? 1}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onUpdate({ opacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      )}

      {spec.kind === 'rect' && (
        <div className="grid grid-cols-2 gap-2">
          <SliderControl
            label="X"
            value={spec.x}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onUpdate({ x: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Y"
            value={spec.y}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onUpdate({ y: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Width"
            value={spec.width}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => onUpdate({ width: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Height"
            value={spec.height}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => onUpdate({ height: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Corner radius"
            value={spec.cornerRadius ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onUpdate({ cornerRadius: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Opacity"
            value={spec.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onUpdate({ opacity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      )}

      {spec.kind === 'circle' && (
        <div className="grid grid-cols-2 gap-2">
          <SliderControl
            label="Center X"
            value={spec.cx}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onUpdate({ cx: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Center Y"
            value={spec.cy}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onUpdate({ cy: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Radius"
            value={spec.r}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => onUpdate({ r: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderControl
            label="Opacity"
            value={spec.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onUpdate({ opacity: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      )}

      {spec.kind === 'text' && (
        <div className="space-y-2">
          <Input
            value={spec.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            placeholder="Layer text"
            size="sm"
            label="Text"
          />
          <div className="grid grid-cols-2 gap-2">
            <SliderControl
              label="X"
              value={spec.x}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onUpdate({ x: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderControl
              label="Y"
              value={spec.y}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onUpdate({ y: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderControl
              label="Size"
              value={spec.size}
              min={0.02}
              max={0.5}
              step={0.01}
              onChange={(v) => onUpdate({ size: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderControl
              label="Opacity"
              value={spec.opacity ?? 1}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onUpdate({ opacity: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-700">
            <label className="flex flex-col gap-0.5">
              <span className="font-medium">Weight</span>
              <select
                value={spec.fontWeight ?? 'normal'}
                onChange={(e) =>
                  onUpdate({ fontWeight: e.target.value as 'normal' | 'bold' })
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
                  onUpdate({ anchor: e.target.value as 'start' | 'middle' | 'end' })
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
