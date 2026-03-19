'use client'

import { useState } from 'react'
import { MagicWand } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import {
  STYLE_PRESETS,
  MEDIUM_PRESETS,
  MOOD_PRESETS,
  ASPECT_RATIOS,
  MODEL_OPTIONS,
  type GenerateParams,
  type StyleKey,
  type MediumKey,
  type MoodKey,
  type AspectRatioKey,
  type ModelKey,
} from '@/lib/constants/art-generator'

interface PromptBuilderProps {
  onGenerate: (params: GenerateParams) => void
  loading: boolean
}

export function PromptBuilder({ onGenerate, loading }: PromptBuilderProps) {
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<string>('')
  const [medium, setMedium] = useState<string>('')
  const [mood, setMood] = useState<string>('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>('1:1')
  const [model, setModel] = useState<ModelKey>('flash')

  const handleGenerate = () => {
    if (!prompt.trim()) return

    const params: GenerateParams = {
      prompt: prompt.trim(),
      model,
      aspectRatio,
      ...(style && { style: style as StyleKey }),
      ...(medium && { medium: medium as MediumKey }),
      ...(mood && { mood: mood as MoodKey }),
    }

    onGenerate(params)
  }

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
      <Textarea
        label="Prompt"
        placeholder="Describe the artwork you want to create..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        required
      />

      <div className="grid grid-cols-3 gap-3">
        <Select
          label="Style"
          options={styleOptions}
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        />
        <Select
          label="Medium"
          options={mediumOptions}
          value={medium}
          onChange={(e) => setMedium(e.target.value)}
        />
        <Select
          label="Mood"
          options={moodOptions}
          value={mood}
          onChange={(e) => setMood(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
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
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleGenerate}
        loading={loading}
        disabled={!prompt.trim()}
        icon={<MagicWand size={18} weight="bold" />}
      >
        Generate Artwork
      </Button>
    </div>
  )
}
