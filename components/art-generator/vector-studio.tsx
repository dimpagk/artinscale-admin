'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Lightning, Polygon, ArrowRight, Stack } from '@phosphor-icons/react'
import { LayerPanel } from './layer-panel'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { listStylePacks } from '@/lib/style-packs'
import { rotateHues } from '@/lib/colors'
import type { GeneratedImage } from '@/lib/constants/art-generator'

/**
 * Vector Studio — the Tier 5 layered/vectorized pipeline.
 *
 *   1. Operator clicks "Vectorize" → calls /vector-variants (no variants yet),
 *      gets back master SVG.
 *   2. Master SVG is shown alongside any generated palette variants.
 *   3. Operator can add new palette variants from:
 *        a. Their style pack's locked palette (one click)
 *        b. Suggested alternates (warm rotation, cool rotation, mono)
 *        c. A custom palette they type in
 *   4. Each variant has a "Promote to Artwork" button that:
 *        a. Renders the SVG to a 4096px PNG via sharp (server-side)
 *        b. Creates an artwork row pointing at the PNG
 *        c. Redirects to the artwork edit page
 *
 * One composition × N palette variants = N Shopify SKUs. The whole point
 * of vectorizing.
 */

interface Variant {
  paletteName: string
  paletteHex: string[]
  svgUrl: string
  svgStoragePath: string
}

interface VectorMetadata {
  masterSvgUrl: string
  masterStoragePath: string
  colorBandCount: number
  variants: Variant[]
  vectorizedAt: string
  isDryRun: boolean
}

interface VectorStudioProps {
  image: GeneratedImage
  onUpdate: (updated: GeneratedImage) => void
}

export function VectorStudio({ image, onUpdate }: VectorStudioProps) {
  const router = useRouter()
  const meta = image.metadata as Record<string, unknown> | null
  const vector = (meta?.vector as VectorMetadata | undefined) ?? null
  const stylePackId = meta?.stylePackId as string | undefined

  const [vectorizing, setVectorizing] = useState(false)
  const [addingVariant, setAddingVariant] = useState(false)
  const [variantName, setVariantName] = useState('')
  const [variantColors, setVariantColors] = useState('')
  const [promoting, setPromoting] = useState<number | null>(null)
  const [editingLayersIndex, setEditingLayersIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Suggested alternate palettes — the operator gets these as one-click adds. */
  const suggestedPalettes = (() => {
    const stylePack = stylePackId
      ? listStylePacks().find((p) => p.id === stylePackId)
      : null
    const base = stylePack?.palette.colors ?? ['#111111', '#fafafa', '#e63946']

    // Three pre-baked alternates — useful starter set the operator can prune
    return [
      {
        name: stylePack ? `${stylePack.persona.name} — locked palette` : 'Locked',
        colors: base,
      },
      {
        name: 'Warm shift',
        colors: rotateHues(base, 30),
      },
      {
        name: 'Cool shift',
        colors: rotateHues(base, -30),
      },
      {
        name: 'Mono',
        colors: ['#0F0F0F', '#444444', '#999999', '#DDDDDD', '#FFFFFF'],
      },
    ]
  })()

  const callVectorEndpoint = async (paletteVariants?: Array<{ name: string; colors: string[] }>) => {
    const res = await fetch(`/api/art-generator/${image.id}/vector-variants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paletteVariants: paletteVariants ?? [] }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    return (await res.json()) as { vector: VectorMetadata; image: GeneratedImage }
  }

  const handleVectorize = async () => {
    setError(null)
    setVectorizing(true)
    try {
      // First-pass: vectorize with all 4 suggested palettes pre-applied so
      // the operator immediately sees variants without extra clicks.
      const result = await callVectorEndpoint(suggestedPalettes)
      onUpdate(result.image)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vectorize failed')
    } finally {
      setVectorizing(false)
    }
  }

  const handleAddVariant = async () => {
    if (!vector) return
    const colors = variantColors
      .split(/[,\s]+/)
      .map((c) => c.trim())
      .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c))
    if (colors.length === 0) {
      setError('Provide at least one #RRGGBB hex color')
      return
    }
    setError(null)
    setAddingVariant(true)
    try {
      // Re-call with all existing variants + the new one (endpoint is
      // additive but actually replaces, so we rebuild the full list).
      const allVariants = [
        ...vector.variants.map((v) => ({ name: v.paletteName, colors: v.paletteHex })),
        { name: variantName.trim() || `Custom ${vector.variants.length + 1}`, colors },
      ]
      const result = await callVectorEndpoint(allVariants)
      onUpdate(result.image)
      setVariantName('')
      setVariantColors('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add variant failed')
    } finally {
      setAddingVariant(false)
    }
  }

  const handlePromoteVariant = async (index: number) => {
    setError(null)
    setPromoting(index)
    try {
      const res = await fetch(`/api/art-generator/${image.id}/promote-variant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant_index: index, render_width: 4096 }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Promote failed (${res.status})`)
      }
      const { artwork } = (await res.json()) as { artwork: { id: string } }
      router.push(`/artworks/${artwork.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promote failed')
      setPromoting(null)
    }
  }

  // ============================================
  // Empty state — image not yet vectorized
  // ============================================
  if (!vector) {
    return (
      <Card>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Polygon size={18} weight="duotone" className="text-gray-700" />
            <h3 className="font-semibold text-gray-900">Vector Studio</h3>
          </div>
          <p className="text-sm text-gray-600">
            Vectorize this image to produce an SVG master and palette variants.
            Each variant becomes a separate Gelato-ready artwork (one composition × N
            colorways = N SKUs).
          </p>
          <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
            Will produce: <strong>1 master SVG</strong> + <strong>{suggestedPalettes.length}</strong>{' '}
            starter variants ({suggestedPalettes.map((p) => p.name).join(', ')}). You can add
            more or delete after.
          </div>
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              {error}
            </div>
          )}
          <Button
            variant="primary"
            onClick={handleVectorize}
            loading={vectorizing}
            icon={<Lightning size={16} weight="bold" />}
          >
            Vectorize
          </Button>
        </div>
      </Card>
    )
  }

  // ============================================
  // Vectorized — show master + variants
  // ============================================
  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Polygon size={18} weight="duotone" className="text-gray-700" />
            <h3 className="font-semibold text-gray-900">Vector Studio</h3>
            <Badge variant="success" size="sm">
              {vector.colorBandCount} layers
            </Badge>
            {vector.isDryRun && (
              <Badge variant="warning" size="sm">
                Dry run
              </Badge>
            )}
          </div>
          <a
            href={vector.masterSvgUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-gray-600 underline-offset-2 hover:underline"
          >
            Master SVG ↗
          </a>
        </div>

        {/* Variants grid */}
        {vector.variants.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {vector.variants.map((variant, idx) => (
              <div
                key={`${variant.svgStoragePath}-${idx}`}
                className="overflow-hidden rounded-lg border border-gray-200 bg-white"
              >
                <div className="relative aspect-square bg-[repeating-linear-gradient(45deg,#f5f5f5_0_8px,#fafafa_8px_16px)]">
                  <img
                    src={variant.svgUrl}
                    alt={variant.paletteName}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="space-y-2 p-2">
                  <div className="flex items-center gap-1">
                    {variant.paletteHex.slice(0, 6).map((color) => (
                      <span
                        key={color}
                        className="h-3 w-3 rounded-full border border-gray-200"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                  <p className="line-clamp-1 text-xs font-medium text-gray-800">
                    {variant.paletteName}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingLayersIndex(idx)}
                      icon={<Stack size={12} />}
                      className="flex-1"
                    >
                      Layers
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handlePromoteVariant(idx)}
                      loading={promoting === idx}
                      disabled={promoting !== null}
                      icon={<ArrowRight size={12} />}
                      className="flex-1"
                    >
                      {promoting === idx ? '…' : 'Promote'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No palette variants yet. Add one below.
          </p>
        )}

        {/* Layer editor for the selected variant */}
        {editingLayersIndex !== null && vector.variants[editingLayersIndex] && (
          <LayerPanel
            imageId={image.id}
            variantIndex={editingLayersIndex}
            variantName={vector.variants[editingLayersIndex].paletteName}
            svgUrl={vector.variants[editingLayersIndex].svgUrl}
            onSaved={(result) => {
              const r = result as { image: GeneratedImage }
              onUpdate(r.image)
              setEditingLayersIndex(null)
            }}
            onClose={() => setEditingLayersIndex(null)}
          />
        )}

        {/* Add custom variant */}
        <div className="space-y-2 rounded-md border border-dashed border-gray-300 p-3">
          <p className="text-xs font-medium text-gray-700">Add a palette variant</p>
          <Input
            label="Variant name"
            placeholder="Spring drop"
            value={variantName}
            onChange={(e) => setVariantName(e.target.value)}
            size="sm"
          />
          <Input
            label="Hex colors (comma-separated)"
            placeholder="#E63946, #1D3557, #F1FAEE"
            value={variantColors}
            onChange={(e) => setVariantColors(e.target.value)}
            size="sm"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAddVariant}
            loading={addingVariant}
            disabled={!variantColors.trim()}
            icon={<Plus size={14} />}
          >
            Add variant
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <p className="text-xs text-gray-500">
          Promote renders the SVG variant to a 4096px PNG and creates an artwork
          you can push to Gelato.
        </p>
      </div>
    </Card>
  )
}

