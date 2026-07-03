'use client'

/**
 * Scene library browser: filterable grid over the mockup-scene catalog.
 *
 * Filters are client-side (the whole catalog is already on the page).
 * The wall-overlay toggle draws each scene's `wallTarget` box so the
 * operator can QA where composited art will sit before a scene enters
 * the rotation.
 */

import { useMemo, useState } from 'react'
import { Check, Copy, Square } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface SceneCard {
  key: string
  room: string
  aesthetic: string
  city: string | null
  cityCode: string | null
  materials: string[]
  light: string | null
  wallTarget: { x: number; y: number; w: number; h: number }
  generated: boolean
  imageUrl: string
}

const ROOM_LABELS: Record<string, string> = {
  office: 'Office',
  bedroom: 'Bedroom',
  'living-room': 'Living room',
  'dining-room': 'Dining room',
  hallway: 'Hallway',
}

export function SceneLibrary({ scenes }: { scenes: SceneCard[] }) {
  const [room, setRoom] = useState<string | null>(null)
  const [city, setCity] = useState<string | null>(null)
  const [aesthetic, setAesthetic] = useState<string | null>(null)
  const [showWallTarget, setShowWallTarget] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const rooms = useMemo(() => [...new Set(scenes.map((s) => s.room))], [scenes])
  const cities = useMemo(
    () => [...new Set(scenes.map((s) => s.city).filter(Boolean))].sort() as string[],
    [scenes]
  )
  const aesthetics = useMemo(
    () => [...new Set(scenes.map((s) => s.aesthetic))].sort(),
    [scenes]
  )

  const filtered = scenes.filter(
    (s) =>
      (!room || s.room === room) &&
      (!city || s.city === city) &&
      (!aesthetic || s.aesthetic === aesthetic)
  )

  const copyUrl = async (scene: SceneCard) => {
    await navigator.clipboard.writeText(scene.imageUrl)
    setCopiedKey(scene.key)
    setTimeout(() => setCopiedKey((k) => (k === scene.key ? null : k)), 1500)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <ChipRow
          label="Room"
          options={rooms.map((r) => ({ value: r, label: ROOM_LABELS[r] ?? r }))}
          selected={room}
          onSelect={setRoom}
        />
        <ChipRow
          label="City"
          options={cities.map((c) => ({ value: c, label: c }))}
          selected={city}
          onSelect={setCity}
        />
        <ChipRow
          label="Mood"
          options={aesthetics.map((a) => ({ value: a, label: a }))}
          selected={aesthetic}
          onSelect={setAesthetic}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {filtered.length} scene{filtered.length === 1 ? '' : 's'}
          {filtered.some((s) => !s.generated) &&
            ` (${filtered.filter((s) => !s.generated).length} not generated yet)`}
        </p>
        <Button
          variant={showWallTarget ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setShowWallTarget((v) => !v)}
          icon={<Square size={14} />}
        >
          Art placement
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((scene) => (
          <div
            key={scene.key}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white"
          >
            <div className="relative aspect-[3/2] bg-gray-100">
              {scene.generated ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={scene.imageUrl}
                  alt={`${scene.city ?? 'Generic'} ${ROOM_LABELS[scene.room] ?? scene.room} scene`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-xs text-gray-400">
                  Not generated yet
                </div>
              )}
              {showWallTarget && scene.generated && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed border-emerald-400/90 bg-emerald-400/10"
                  style={{
                    left: `${scene.wallTarget.x * 100}%`,
                    top: `${scene.wallTarget.y * 100}%`,
                    width: `${scene.wallTarget.w * 100}%`,
                    height: `${scene.wallTarget.h * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {scene.city ?? 'Generic'} · {ROOM_LABELS[scene.room] ?? scene.room}
                  </p>
                  <p className="truncate font-mono text-[11px] text-gray-400">{scene.key}</p>
                </div>
                {scene.generated ? (
                  <button
                    type="button"
                    onClick={() => copyUrl(scene)}
                    className="shrink-0 rounded-md border border-gray-200 p-1.5 text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-800"
                    title="Copy image URL"
                  >
                    {copiedKey === scene.key ? (
                      <Check size={13} className="text-emerald-600" />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                ) : (
                  <Badge variant="warning" size="sm">
                    missing
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" size="sm">
                  {scene.aesthetic}
                </Badge>
                {scene.materials.slice(0, 2).map((m) => (
                  <Badge key={m} variant="outline" size="sm">
                    {m}
                  </Badge>
                ))}
              </div>
              {scene.light && (
                <p className="line-clamp-2 text-xs text-gray-500">{scene.light}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChipRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string | null
  onSelect: (value: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-10 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <Chip label="All" active={selected === null} onClick={() => onSelect(null)} />
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          active={selected === o.value}
          onClick={() => onSelect(selected === o.value ? null : o.value)}
        />
      ))}
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active
          ? 'border-brand-navy bg-brand-navy text-white'
          : 'border-gray-200 bg-white text-gray-600 hover:border-brand-navy/40 hover:text-brand-navy'
      }`}
    >
      {label}
    </button>
  )
}
