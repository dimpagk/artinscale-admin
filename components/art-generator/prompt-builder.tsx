'use client'

import { useState, useEffect } from 'react'
import { MagicWand } from '@phosphor-icons/react'

const PROMPT_BUILDER_PREFS_KEY = 'artinscale-promptbuilder-prefs-v1'

interface StoredPrefs {
  count?: string
  stylePackId?: string
  aspectRatio?: string
  model?: string
  engine?: 'gemini' | 'claude_vector'
}

function loadPrefs(): StoredPrefs {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(PROMPT_BUILDER_PREFS_KEY)
    return raw ? (JSON.parse(raw) as StoredPrefs) : {}
  } catch {
    return {}
  }
}

function savePrefs(prefs: StoredPrefs) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PROMPT_BUILDER_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // ignore storage quota errors
  }
}
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { FormGrid } from '@/components/admin-ui'
import {
  STYLE_PRESETS,
  MEDIUM_PRESETS,
  MOOD_PRESETS,
  ASPECT_RATIOS,
  MODEL_OPTIONS,
  type GenerateParams,
  type GeneratorEngine,
  type StyleKey,
  type MediumKey,
  type MoodKey,
  type AspectRatioKey,
  type ModelKey,
} from '@/lib/constants/art-generator'
import { listLaunchStylePacks } from '@/lib/style-packs'

interface PromptBuilderProps {
  onGenerate: (params: GenerateParams, opts?: { count?: number }) => void
  loading: boolean
  /**
   * Optional controlled-input pattern for the prompt textarea. When
   * `value` is provided, the parent owns the state — useful for
   * surfaces like the cluster picker's "Use suggested subject"
   * button that need to push values down into the input. Falls back
   * to internal state when omitted, preserving the original API.
   */
  value?: string
  onChange?: (next: string) => void
  /**
   * When true, the subject may be left blank; the parent will derive one
   * from the selected topic's contributions at generate time. Set by the
   * parent when a topic context is available. A typed subject still wins.
   */
  allowEmptySubject?: boolean
}

export function PromptBuilder({
  onGenerate,
  loading,
  value,
  onChange,
  allowEmptySubject = false,
}: PromptBuilderProps) {
  const isControlled = value !== undefined && onChange !== undefined
  const [internalPrompt, setInternalPrompt] = useState('')
  const prompt = isControlled ? value : internalPrompt
  const setPrompt = isControlled ? onChange : setInternalPrompt
  const [stylePackId, setStylePackId] = useState<string>('')
  const [style, setStyle] = useState<string>('')
  const [medium, setMedium] = useState<string>('')
  const [mood, setMood] = useState<string>('')
  // Defaults aimed at the operator's typical workflow: Pro model
  // (every kept output gets printed — quality compounds), 3 variations
  // (cherry-picking is the AI-gen UX), 7:10 portrait (matches the
  // most museum-poster sizes — 21×30 + 70×100 cm). Persisted prefs
  // (loaded below) override these per-operator.
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>('7:10')
  const [model, setModel] = useState<ModelKey>('pro')
  const [count, setCount] = useState<string>('3')
  const [engine, setEngine] = useState<GeneratorEngine>('gemini')

  // Persist last-used count + style pack + aspect ratio + model + engine across reloads
  useEffect(() => {
    const prefs = loadPrefs()
    if (prefs.count) setCount(prefs.count)
    if (prefs.stylePackId) setStylePackId(prefs.stylePackId)
    if (prefs.aspectRatio) setAspectRatio(prefs.aspectRatio as AspectRatioKey)
    if (prefs.model) setModel(prefs.model as ModelKey)
    if (prefs.engine === 'claude_vector' || prefs.engine === 'gemini') setEngine(prefs.engine)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    savePrefs({ count, stylePackId, aspectRatio, model, engine })
  }, [count, stylePackId, aspectRatio, model, engine])

  const stylePackActive = !!stylePackId
  const isVector = engine === 'claude_vector'
  const canGenerate = stylePackActive || !isVector

  const emptySubjectOk = allowEmptySubject && !prompt.trim()

  const handleGenerate = () => {
    if (!prompt.trim() && !allowEmptySubject) return

    const params: GenerateParams = {
      prompt: prompt.trim(),
      model,
      aspectRatio,
      engine,
      ...(stylePackActive
        ? { stylePackId }
        : {
            ...(style && { style: style as StyleKey }),
            ...(medium && { medium: medium as MediumKey }),
            ...(mood && { mood: mood as MoodKey }),
          }),
    }

    const requestedCount = Number(count) || 1
    const max = isVector ? 3 : 10
    const n = Math.max(1, Math.min(max, requestedCount))
    onGenerate(params, { count: n })
  }

  const stylePackOptions = [
    { value: '', label: 'No artist (use legacy presets below)' },
    ...listLaunchStylePacks().map((pack) => ({
      value: pack.id,
      label: `${pack.persona.name} — ${pack.persona.tagline}`,
    })),
  ]

  const styleOptions = [
    { value: '', label: 'Any style' },
    ...STYLE_PRESETS.map((s) => ({ value: s.key, label: s.label })),
  ]

  const mediumOptions = [
    { value: '', label: 'Any medium' },
    ...MEDIUM_PRESETS.map((m) => ({ value: m.key, label: m.label })),
  ]

  const moodOptions = [
    { value: '', label: 'Any mood' },
    ...MOOD_PRESETS.map((m) => ({ value: m.key, label: m.label })),
  ]

  const aspectRatioOptions = ASPECT_RATIOS.map((a) => ({
    value: a.key,
    label: a.label,
  }))

  const modelOptions = MODEL_OPTIONS.map((m) => ({
    value: m.key,
    label: m.label,
  }))

  return (
    <div className="space-y-4">
      <Select
        label="Engine"
        options={[
          { value: 'gemini', label: 'Image — Gemini 2.5 (raster)' },
          { value: 'claude_vector', label: 'Vector — Claude (native SVG)' },
        ]}
        value={engine}
        onChange={(e) => setEngine(e.target.value as GeneratorEngine)}
        helperText={
          isVector
            ? 'Claude writes SVG directly. Best for Bauhaus + line-art. Requires a style pack. Slower per call (~30s) but produces native vectors.'
            : 'Gemini Nano Banana 2 — raster. Fast (~10s). Vectorize after, if needed.'
        }
      />

      <Select
        label="Artist"
        options={stylePackOptions}
        value={stylePackId}
        onChange={(e) => setStylePackId(e.target.value)}
        helperText={
          isVector && !stylePackActive
            ? '⚠ Vector mode requires picking an artist — each artist owns a style pack with palette + composition rules.'
            : stylePackActive
            ? 'The selected artist supplies the full visual voice — palette, composition, prompt. The legacy style/medium/mood presets below are ignored.'
            : 'Pick a launch artist to lock in their visual voice (palette + composition + prompt template).'
        }
      />

      <Textarea
        label={stylePackActive ? 'Subject (what should the artist depict?)' : 'Prompt'}
        placeholder={
          stylePackActive
            ? 'A subject only — e.g. "a hand cradling smoke", "two birds at dawn". The selected artist supplies all style.'
            : 'Describe the artwork you want to create...'
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        required={!allowEmptySubject}
        helperText={
          allowEmptySubject
            ? 'Optional: leave blank to auto-derive a subject from the selected topic. Type one to take control.'
            : undefined
        }
      />

      {/* Vector mode hides the structured presets entirely — they're
          ignored by the Claude vector route. */}
      {!isVector && (
        <FormGrid
          columns={3}
          className={stylePackActive ? 'pointer-events-none opacity-40' : ''}
        >
          <Select
            label="Style"
            options={styleOptions}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            disabled={stylePackActive}
          />
          <Select
            label="Medium"
            options={mediumOptions}
            value={medium}
            onChange={(e) => setMedium(e.target.value)}
            disabled={stylePackActive}
          />
          <Select
            label="Mood"
            options={moodOptions}
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            disabled={stylePackActive}
          />
        </FormGrid>
      )}

      {!isVector && (
        <FormGrid columns={3}>
          <Select
            label="Aspect Ratio"
            options={aspectRatioOptions}
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatioKey)}
          />
          <Select
            label="Model"
            options={modelOptions}
            value={model}
            onChange={(e) => setModel(e.target.value as ModelKey)}
          />
          <Select
            label="Variations"
            options={[
              { value: '1', label: '1 piece' },
              { value: '3', label: '3 variations' },
              { value: '5', label: '5 variations' },
              { value: '10', label: '10 variations' },
            ]}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            helperText={Number(count) > 1 ? `~${(Number(count) * 12).toFixed(0)}s sequential` : undefined}
          />
        </FormGrid>
      )}
      {isVector && (
        <Select
          label="Variations"
          options={[
            { value: '1', label: '1 piece' },
            { value: '2', label: '2 variations' },
            { value: '3', label: '3 variations' },
          ]}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          helperText="Vector mode is slower per call (~30s); cap at 3 variations to keep iteration tight."
        />
      )}

      <Button
        variant="primary"
        className="w-full"
        onClick={handleGenerate}
        loading={loading}
        disabled={(!prompt.trim() && !allowEmptySubject) || !canGenerate}
        icon={<MagicWand size={18} weight="bold" />}
      >
        {!canGenerate
          ? 'Pick a style pack first'
          : emptySubjectOk
          ? Number(count) > 1
            ? `Generate ${count} from topic`
            : 'Generate from topic'
          : isVector
          ? Number(count) > 1
            ? `Generate ${count} vector variations`
            : 'Generate vector'
          : Number(count) > 1
          ? `Generate ${count} variations`
          : 'Generate artwork'}
      </Button>
    </div>
  )
}
