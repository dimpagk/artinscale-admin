'use client'

import { useState } from 'react'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { TopicRow } from '@/lib/types'

interface TopicContextPickerProps {
  topics: TopicRow[]
  onContextChange: (context: string) => void
}

export function TopicContextPicker({ topics, onContextChange }: TopicContextPickerProps) {
  const [selectedTopic, setSelectedTopic] = useState('')
  const [context, setContext] = useState('')

  const topicOptions = [
    { value: '', label: 'No topic' },
    ...topics.map((t) => ({ value: t.id, label: t.title })),
  ]

  const handleTopicChange = (value: string) => {
    setSelectedTopic(value)
    setContext('')
    onContextChange('')
  }

  const handleContextChange = (value: string) => {
    setContext(value)
    onContextChange(value)
  }

  return (
    <div className="space-y-3">
      <Select
        label="Topic"
        options={topicOptions}
        value={selectedTopic}
        onChange={(e) => handleTopicChange(e.target.value)}
      />

      {selectedTopic && (
        <Textarea
          label="Creative context from contributions"
          placeholder="Paste or type contribution excerpts to inspire the AI"
          helperText="Add community contributions to guide the artwork generation"
          value={context}
          onChange={(e) => handleContextChange(e.target.value)}
          rows={3}
        />
      )}
    </div>
  )
}
