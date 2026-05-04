'use client'

import { useState } from 'react'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import type { TopicRow } from '@/lib/types'

interface TopicContextPickerProps {
  topics: TopicRow[]
  onContextChange: (context: string) => void
}

interface FetchResult {
  count: number
  formatted: string
}

export function TopicContextPicker({ topics, onContextChange }: TopicContextPickerProps) {
  const [selectedTopic, setSelectedTopic] = useState('')
  const [context, setContext] = useState('')
  const [loadingContext, setLoadingContext] = useState(false)
  const [autoFillStatus, setAutoFillStatus] = useState<string | null>(null)

  const topicOptions = [
    { value: '', label: 'No topic' },
    ...topics.map((t) => ({ value: t.id, label: t.title })),
  ]

  const fetchContext = async (topicId: string): Promise<FetchResult | null> => {
    setLoadingContext(true)
    try {
      const res = await fetch(`/api/topics/${topicId}/contributions?limit=5`)
      if (!res.ok) {
        setAutoFillStatus(`Couldn't load contributions (${res.status})`)
        return null
      }
      return (await res.json()) as FetchResult
    } catch (err) {
      setAutoFillStatus(err instanceof Error ? err.message : 'Fetch failed')
      return null
    } finally {
      setLoadingContext(false)
    }
  }

  const handleTopicChange = async (value: string) => {
    setSelectedTopic(value)
    setContext('')
    onContextChange('')
    setAutoFillStatus(null)
    if (!value) return

    const result = await fetchContext(value)
    if (!result) return

    if (result.count === 0) {
      setAutoFillStatus(
        'No approved + public contributions yet — paste excerpts manually below.'
      )
    } else {
      setContext(result.formatted)
      onContextChange(result.formatted)
      setAutoFillStatus(`Auto-filled ${result.count} approved contribution${result.count === 1 ? '' : 's'} — edit freely.`)
    }
  }

  const handleContextChange = (value: string) => {
    setContext(value)
    onContextChange(value)
  }

  const handleRefresh = async () => {
    if (!selectedTopic) return
    const result = await fetchContext(selectedTopic)
    if (!result) return
    if (result.count === 0) {
      setAutoFillStatus('Still no approved contributions for this topic.')
      return
    }
    setContext(result.formatted)
    onContextChange(result.formatted)
    setAutoFillStatus(`Refreshed: ${result.count} contributions.`)
  }

  return (
    <div className="space-y-3">
      <Select
        label="Topic"
        options={topicOptions}
        value={selectedTopic}
        onChange={(e) => handleTopicChange(e.target.value)}
        helperText={loadingContext ? 'Loading contributions…' : undefined}
      />

      {selectedTopic && (
        <>
          <Textarea
            label="Creative context from contributions"
            placeholder="Auto-filled from approved community contributions. Edit or replace as needed."
            helperText="The AI uses this as inspiration, not as literal subject matter."
            value={context}
            onChange={(e) => handleContextChange(e.target.value)}
            rows={5}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              {autoFillStatus ?? '—'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              loading={loadingContext}
              icon={<ArrowsClockwise size={14} weight="bold" />}
            >
              Refresh
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
