'use client'

import { useState } from 'react'
import { ArrowsClockwise, Sparkle } from '@phosphor-icons/react'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import type { TopicRow } from '@/lib/types'

interface TopicContextPickerProps {
  topics: TopicRow[]
  onContextChange: (context: string) => void
  /**
   * Optional — when provided, operator can pick a cluster's
   * suggestedSubject to drop into the prompt. If omitted, the
   * "Use this subject" button is hidden (caller doesn't manage the
   * subject from this component).
   */
  onSubjectSuggest?: (subject: string) => void
}

interface ContributionsResult {
  count: number
  formatted: string
  contributions: Array<{
    id: string
    type: string
    contributor_name: string
    contributor_location: string | null
    content: string | null
    caption: string | null
  }>
}

interface ClusterChip {
  id: string
  title: string
  description: string
  contributionIds: string[]
  suggestedSubject: string
}

interface ClustersResult {
  clustering: {
    generatedAt: string
    contributionsCount: number
    clusters: ClusterChip[]
  }
  skipped: boolean
}

export function TopicContextPicker({ topics, onContextChange, onSubjectSuggest }: TopicContextPickerProps) {
  const [selectedTopic, setSelectedTopic] = useState('')
  const [context, setContext] = useState('')
  const [loadingContext, setLoadingContext] = useState(false)
  const [autoFillStatus, setAutoFillStatus] = useState<string | null>(null)

  // Cluster state — populated after the topic select fetches /clusters.
  // `selectedClusterId='all'` means "use the full unclustered list"
  // (the default after topic selection).
  const [clusters, setClusters] = useState<ClusterChip[]>([])
  const [selectedClusterId, setSelectedClusterId] = useState<string>('all')
  const [loadingClusters, setLoadingClusters] = useState(false)
  const [allContributions, setAllContributions] = useState<ContributionsResult['contributions']>([])

  const topicOptions = [
    { value: '', label: 'No topic' },
    ...topics.map((t) => ({ value: t.id, label: t.title })),
  ]

  const fetchContributions = async (topicId: string): Promise<ContributionsResult | null> => {
    try {
      const res = await fetch(`/api/topics/${topicId}/contributions?limit=10`)
      if (!res.ok) {
        setAutoFillStatus(`Couldn't load contributions (${res.status})`)
        return null
      }
      return (await res.json()) as ContributionsResult
    } catch (err) {
      setAutoFillStatus(err instanceof Error ? err.message : 'Fetch failed')
      return null
    }
  }

  const fetchClusters = async (topicId: string, refresh = false): Promise<ClustersResult | null> => {
    setLoadingClusters(true)
    try {
      const url = `/api/topics/${topicId}/clusters${refresh ? '?refresh=1' : ''}`
      const res = await fetch(url)
      if (!res.ok) return null
      const json = (await res.json()) as ClustersResult & { ok: boolean; error?: string }
      if (!json.ok) return null
      return json
    } catch {
      return null
    } finally {
      setLoadingClusters(false)
    }
  }

  const formatCluster = (cluster: ClusterChip, contributions: ContributionsResult['contributions']): string => {
    const set = new Set(cluster.contributionIds)
    const inCluster = contributions.filter((c) => set.has(c.id))
    if (inCluster.length === 0) return ''
    return inCluster
      .map((c) => {
        const where = c.contributor_location ? ` (${c.contributor_location})` : ''
        const text = c.type === 'story' ? c.content ?? '' : c.caption ?? ''
        const trimmed = text.trim().slice(0, 280)
        if (!trimmed) return null
        return `${c.contributor_name}${where}: "${trimmed}"`
      })
      .filter(Boolean)
      .join('\n\n')
  }

  const handleTopicChange = async (value: string) => {
    setSelectedTopic(value)
    setContext('')
    onContextChange('')
    setAutoFillStatus(null)
    setClusters([])
    setSelectedClusterId('all')
    setAllContributions([])
    if (!value) return

    setLoadingContext(true)
    const [cResult, kResult] = await Promise.all([fetchContributions(value), fetchClusters(value)])
    setLoadingContext(false)

    if (cResult) {
      setAllContributions(cResult.contributions)
      if (cResult.count === 0) {
        setAutoFillStatus(
          'No approved + public contributions yet — paste excerpts manually below.'
        )
      } else {
        setContext(cResult.formatted)
        onContextChange(cResult.formatted)
        setAutoFillStatus(`Auto-filled ${cResult.count} approved contribution${cResult.count === 1 ? '' : 's'} — edit freely.`)
      }
    }

    // Clusters are optional — only show when we got at least 2 of them.
    if (kResult && kResult.clustering.clusters.length >= 2) {
      setClusters(kResult.clustering.clusters)
    }
  }

  const handleClusterPick = (clusterId: string) => {
    setSelectedClusterId(clusterId)
    if (clusterId === 'all') {
      // Restore the full list
      const formatted = allContributions
        .map((c) => {
          const where = c.contributor_location ? ` (${c.contributor_location})` : ''
          const text = c.type === 'story' ? c.content ?? '' : c.caption ?? ''
          const trimmed = text.trim().slice(0, 280)
          if (!trimmed) return null
          return `${c.contributor_name}${where}: "${trimmed}"`
        })
        .filter(Boolean)
        .join('\n\n')
      setContext(formatted)
      onContextChange(formatted)
      return
    }
    const cluster = clusters.find((c) => c.id === clusterId)
    if (!cluster) return
    const formatted = formatCluster(cluster, allContributions)
    setContext(formatted)
    onContextChange(formatted)
  }

  const handleContextChange = (value: string) => {
    setContext(value)
    onContextChange(value)
  }

  const handleRefreshClusters = async () => {
    if (!selectedTopic) return
    const k = await fetchClusters(selectedTopic, true)
    if (k && k.clustering.clusters.length >= 2) {
      setClusters(k.clustering.clusters)
      // If the previously-picked cluster id no longer exists, fall back to 'all'.
      if (!k.clustering.clusters.some((c) => c.id === selectedClusterId)) {
        handleClusterPick('all')
      }
    }
  }

  const activeCluster = clusters.find((c) => c.id === selectedClusterId)

  return (
    <div className="space-y-3">
      <Select
        label="Topic"
        options={topicOptions}
        value={selectedTopic}
        onChange={(e) => handleTopicChange(e.target.value)}
        helperText={
          loadingContext
            ? 'Loading contributions…'
            : loadingClusters
              ? 'Clustering contributions by theme…'
              : undefined
        }
      />

      {selectedTopic && clusters.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-700">
              Theme cluster
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRefreshClusters}
              loading={loadingClusters}
              icon={<ArrowsClockwise size={12} weight="bold" />}
            >
              Re-cluster
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => handleClusterPick('all')}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                selectedClusterId === 'all'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-500'
              }`}
            >
              All ({allContributions.length})
            </button>
            {clusters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleClusterPick(c.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  selectedClusterId === c.id
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-500'
                }`}
                title={c.description}
              >
                {c.title} ({c.contributionIds.length})
              </button>
            ))}
          </div>
          {activeCluster && (
            <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <div className="mb-1 font-medium">{activeCluster.title}</div>
              <div className="text-gray-600">{activeCluster.description}</div>
              {activeCluster.suggestedSubject && (
                <div className="mt-2 flex items-start gap-2">
                  <Sparkle size={12} weight="fill" className="mt-0.5 flex-shrink-0 text-gray-500" />
                  <div className="flex-1 italic text-gray-600">
                    Suggested subject: &quot;{activeCluster.suggestedSubject}&quot;
                  </div>
                  {onSubjectSuggest && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSubjectSuggest(activeCluster.suggestedSubject)}
                    >
                      Use
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
          </div>
        </>
      )}
    </div>
  )
}
