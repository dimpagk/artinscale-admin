'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { FormCard, FormGrid } from '@/components/admin-ui'
import { createStylePackAction } from './actions'

interface NewPackFormProps {
  artists: Array<{ id: string; name: string; email: string; hasPack: boolean }>
  /** Pre-selected artist (from ?artist= query param) */
  defaultArtistId?: string
  /** Existing pack ids the operator can copy from as a template */
  templateOptions: Array<{ id: string; label: string }>
}

export function NewPackForm({
  artists,
  defaultArtistId,
  templateOptions,
}: NewPackFormProps) {
  const router = useRouter()
  const [packId, setPackId] = useState('')
  const [artistId, setArtistId] = useState(defaultArtistId ?? '')
  const [copyFromId, setCopyFromId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Multi-pack is supported (migration 014) — artists who already own a
  // pack stay selectable, but the new pack will land non-primary so the
  // existing primary keeps driving downstream agents.
  const artistOptions = [
    { value: '', label: 'Choose an artist…' },
    ...artists.map((a) => ({
      value: a.id,
      label: `${a.name || a.email}${a.hasPack ? ' (will be a variant)' : ''}`,
    })),
  ]

  const templateSelectOptions = [
    { value: '', label: 'Start from a sparse template' },
    ...templateOptions.map((t) => ({ value: t.id, label: `Copy from ${t.label}` })),
  ]

  const handleSubmit = async () => {
    setError(null)
    if (!artistId) {
      setError('Pick an artist.')
      return
    }
    setSubmitting(true)
    try {
      await createStylePackAction({
        id: packId.trim().toLowerCase(),
        artistId,
        copyFromId: copyFromId || null,
      })
      // createStylePackAction redirects on success; this only runs on error
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create style pack')
      setSubmitting(false)
    }
  }

  return (
    <FormCard
      title="New style pack"
      description="Pick the artist this pack will belong to. If they already have a pack, the new one lands as a non-primary variant — you can promote it later from the artist's page."
    >
      <FormGrid columns={2}>
        <Input
          label="Pack ID"
          placeholder="e.g. midcentury-poster"
          value={packId}
          onChange={(e) => setPackId(e.target.value)}
          helperText="Kebab-case slug, will become the URL: /styles/<id>"
          required
        />

        <Select
          label="Artist"
          options={artistOptions}
          value={artistId}
          onChange={(e) => setArtistId(e.target.value)}
          disabled={!!defaultArtistId}
          helperText={
            defaultArtistId
              ? 'Pre-selected from the previous page.'
              : 'Pick any artist — multiple packs per artist are supported.'
          }
          required
        />
      </FormGrid>

      <Select
        label="Template"
        options={templateSelectOptions}
        value={copyFromId}
        onChange={(e) => setCopyFromId(e.target.value)}
        helperText="Optional. Copying lets you start from an existing pack's prompt + palette + composition and tweak from there."
      />

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button
          onClick={handleSubmit}
          loading={submitting}
          disabled={submitting || !packId.trim() || !artistId}
        >
          Create &amp; edit
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </FormCard>
  )
}
