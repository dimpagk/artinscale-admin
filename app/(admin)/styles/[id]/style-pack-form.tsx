'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkle } from '@phosphor-icons/react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FormCard, FormGrid } from '@/components/admin-ui'
import { ReferenceImages } from '@/components/styles/reference-images'
import type { StylePack } from '@/lib/style-packs'
import { updateStylePackAction } from './actions'

interface StylePackFormProps {
  pack: StylePack
}

export function StylePackForm({ pack }: StylePackFormProps) {
  const router = useRouter()

  const [enabledForLaunch, setEnabledForLaunch] = useState(pack.enabledForLaunch)
  const [vectorizesWell, setVectorizesWell] = useState(pack.vectorizesWell)
  const [personaName, setPersonaName] = useState(pack.persona.name)
  const [personaTagline, setPersonaTagline] = useState(pack.persona.tagline)
  const [personaBio, setPersonaBio] = useState(pack.persona.bioMd)
  const [personaProcess, setPersonaProcess] = useState(pack.persona.processMd)
  const [promptMaster, setPromptMaster] = useState(pack.prompt.master)
  const [promptNegative, setPromptNegative] = useState(pack.prompt.negative)
  const [paletteColors, setPaletteColors] = useState(pack.palette.colors.join(', '))
  const [paletteDescription, setPaletteDescription] = useState(pack.palette.description)
  const [compositionPlacement, setCompositionPlacement] = useState(pack.composition.subjectPlacement)
  const [compositionMaxSubjects, setCompositionMaxSubjects] = useState(pack.composition.maxSubjects)
  const [compositionAspectRatios, setCompositionAspectRatios] = useState(pack.composition.aspectRatios.join(', '))
  const [compositionNotes, setCompositionNotes] = useState(pack.composition.notes)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [paletteSuggestions, setPaletteSuggestions] = useState<string[]>([])
  const [suggestingPalette, setSuggestingPalette] = useState(false)
  const [suggestionMessage, setSuggestionMessage] = useState<string | null>(null)

  const requestPaletteSuggestions = async () => {
    setSuggestingPalette(true)
    setSuggestionMessage(null)
    try {
      const res = await fetch(`/api/style-packs/${pack.id}/suggest-palette`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        suggestions?: string[]
        exemplarCount?: number
        message?: string
      }
      setPaletteSuggestions(data.suggestions ?? [])
      if (data.message) setSuggestionMessage(data.message)
      else if (data.exemplarCount !== undefined) {
        setSuggestionMessage(
          `Read ${data.exemplarCount} exemplar${data.exemplarCount === 1 ? '' : 's'}. Click any swatch to add to the palette.`
        )
      }
    } catch (err) {
      setSuggestionMessage(err instanceof Error ? err.message : 'Suggest failed')
    } finally {
      setSuggestingPalette(false)
    }
  }

  const addSuggestedColor = (color: string) => {
    if (paletteColors.toLowerCase().includes(color.toLowerCase())) return
    const trimmed = paletteColors.trim()
    setPaletteColors(trimmed ? `${trimmed}, ${color}` : color)
    setPaletteSuggestions((prev) => prev.filter((c) => c !== color))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateStylePackAction({
        id: pack.id,
        enabledForLaunch,
        vectorizesWell,
        personaName,
        personaTagline,
        personaBio,
        personaProcess,
        promptMaster,
        promptNegative,
        paletteColors,
        paletteDescription,
        compositionPlacement,
        compositionMaxSubjects,
        compositionAspectRatios,
        compositionNotes,
      })
      setSavedAt(new Date().toLocaleTimeString())
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Preview of the parsed palette so the operator sees swatches as they type
  const parsedColors = paletteColors
    .split(/[,\n]/)
    .map((c) => c.trim())
    .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c))

  return (
    <div className="space-y-6 max-w-3xl">
      <FormCard title="Launch settings">
        <FormGrid columns={2}>
          <Switch
            label="Enabled for launch"
            checked={enabledForLaunch}
            onCheckedChange={setEnabledForLaunch}
          />
          <Switch
            label="Vectorizes well (Phase 4)"
            checked={vectorizesWell}
            onCheckedChange={setVectorizesWell}
          />
        </FormGrid>
      </FormCard>

      <FormCard
        title="Persona"
        description="Customer-facing identity. The drop campaign drafter and email templates use these fields verbatim."
      >
        <FormGrid columns={2}>
          <Input
            label="Name"
            value={personaName}
            onChange={(e) => setPersonaName(e.target.value)}
            required
          />
          <Input
            label="Tagline"
            value={personaTagline}
            onChange={(e) => setPersonaTagline(e.target.value)}
            required
          />
        </FormGrid>
        <Textarea
          label="Bio (markdown)"
          value={personaBio}
          onChange={(e) => setPersonaBio(e.target.value)}
          rows={4}
        />
        <Textarea
          label="Process (markdown)"
          value={personaProcess}
          onChange={(e) => setPersonaProcess(e.target.value)}
          rows={4}
          helperText="How this artist works — used in social copy and on the artist page."
        />
      </FormCard>

      <FormCard
        title="Prompt"
        description="What gets injected into every Gemini call for this style. Be specific."
      >
        <Textarea
          label="Master prompt"
          value={promptMaster}
          onChange={(e) => setPromptMaster(e.target.value)}
          rows={6}
          required
        />
        <Textarea
          label="Negative prompt (avoid)"
          value={promptNegative}
          onChange={(e) => setPromptNegative(e.target.value)}
          rows={3}
        />
      </FormCard>

      <FormCard
        title="Palette"
        description="Locked color set. The artist works only in these hex values."
      >
        <Textarea
          label="Hex colors (comma- or newline-separated)"
          value={paletteColors}
          onChange={(e) => setPaletteColors(e.target.value)}
          rows={2}
          helperText={`${parsedColors.length} valid color${parsedColors.length === 1 ? '' : 's'} parsed`}
        />
        <div className="flex flex-wrap items-center gap-2">
          {parsedColors.map((c) => (
            <div key={c} className="flex items-center gap-1.5">
              <span
                className="h-6 w-6 rounded-full border border-gray-200"
                style={{ backgroundColor: c }}
              />
              <span className="font-mono text-xs text-gray-700">{c}</span>
            </div>
          ))}
        </div>
        <Textarea
          label="Palette usage notes"
          value={paletteDescription}
          onChange={(e) => setPaletteDescription(e.target.value)}
          rows={3}
        />

        <div className="space-y-2 rounded-md border border-dashed border-gray-300 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-gray-700">
              Suggest palette from ★ exemplars
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={requestPaletteSuggestions}
              loading={suggestingPalette}
              icon={<Sparkle size={14} />}
            >
              {paletteSuggestions.length > 0 ? 'Re-analyze' : 'Suggest'}
            </Button>
          </div>
          {suggestionMessage && (
            <p className="text-xs text-gray-500">{suggestionMessage}</p>
          )}
          {paletteSuggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {paletteSuggestions.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => addSuggestedColor(color)}
                  className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs hover:border-gray-400"
                  title={`Add ${color} to palette`}
                >
                  <span
                    className="h-4 w-4 rounded-full border border-gray-200"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono">{color}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </FormCard>

      <ReferenceImages
        packId={pack.id}
        initialPaths={pack.referenceAssetPaths ?? []}
      />

      <FormCard title="Composition">
        <FormGrid columns={2}>
          <Input
            label="Subject placement"
            value={compositionPlacement}
            onChange={(e) => setCompositionPlacement(e.target.value)}
          />
          <Input
            label="Max subjects"
            type="number"
            min={1}
            max={10}
            value={compositionMaxSubjects}
            onChange={(e) => setCompositionMaxSubjects(Number(e.target.value))}
          />
        </FormGrid>
        <Input
          label="Aspect ratios (comma-separated, e.g. 4:5, 2:3)"
          value={compositionAspectRatios}
          onChange={(e) => setCompositionAspectRatios(e.target.value)}
        />
        <Textarea
          label="Composition notes"
          value={compositionNotes}
          onChange={(e) => setCompositionNotes(e.target.value)}
          rows={4}
        />
      </FormCard>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={handleSave} loading={saving}>
          Save changes
        </Button>
        {savedAt && (
          <p className="text-xs text-gray-500">Saved at {savedAt}</p>
        )}
      </div>
    </div>
  )
}
