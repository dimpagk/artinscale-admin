'use client'

import { useState, useMemo } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export interface ArtworkWithArtist {
  id: string
  title: string
  artistName: string
  imageUrl?: string
  status: 'available' | 'limited' | 'sold_out' | 'coming_soon'
  editionSize: number
  editionSold: number
}

interface ArtworkPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (artwork: ArtworkWithArtist) => void
  artworks?: ArtworkWithArtist[]
}

const statusConfig: Record<ArtworkWithArtist['status'], { label: string; variant: 'success' | 'warning' | 'error' | 'secondary' }> = {
  available: { label: 'Available', variant: 'success' },
  limited: { label: 'Limited', variant: 'warning' },
  sold_out: { label: 'Sold Out', variant: 'error' },
  coming_soon: { label: 'Coming Soon', variant: 'secondary' },
}

export function ArtworkPicker({ open, onClose, onSelect, artworks = [] }: ArtworkPickerProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return artworks
    const q = search.toLowerCase()
    return artworks.filter(
      a => a.title.toLowerCase().includes(q) || a.artistName.toLowerCase().includes(q)
    )
  }, [artworks, search])

  const handleSelect = (artwork: ArtworkWithArtist) => {
    onSelect(artwork)
    onClose()
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="Select Artwork" size="lg">
      <div className="space-y-4">
        {/* Search */}
        <div className="relative">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30 placeholder:text-gray-300"
            placeholder="Search by title or artist..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            {artworks.length === 0 ? 'No artworks available' : 'No artworks match your search'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
            {filtered.map(artwork => {
              const sc = statusConfig[artwork.status]
              return (
                <button
                  key={artwork.id}
                  onClick={() => handleSelect(artwork)}
                  className={cn(
                    'text-left border border-gray-200 rounded-xl p-3 transition-all',
                    'hover:border-[#F72D5E]/40 hover:shadow-sm hover:bg-gray-50/50',
                    'focus:outline-none focus:ring-2 focus:ring-[#F72D5E]/20'
                  )}
                >
                  {/* Image */}
                  <div className="w-full aspect-square rounded-lg bg-gray-100 mb-2 overflow-hidden">
                    {artwork.imageUrl ? (
                      <img
                        src={artwork.imageUrl}
                        alt={artwork.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">
                        &#x1F5BC;
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-gray-900 truncate">{artwork.title}</div>
                    <div className="text-xs text-gray-500 truncate">{artwork.artistName}</div>
                    <div className="flex items-center justify-between gap-1">
                      <Badge variant={sc.variant} size="sm" className="text-[10px]">
                        {sc.label}
                      </Badge>
                      <span className="text-[10px] text-gray-400">
                        {artwork.editionSold}/{artwork.editionSize}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
