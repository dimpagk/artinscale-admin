'use client'

import { useState } from 'react'
import { BLOCK_TYPES, type BlockType } from '@/lib/constants/content'
import { ArrowUp, ArrowDown, Trash, Plus } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface BlockEditorProps {
  blocks: BlockType[]
  onChange: (blocks: BlockType[]) => void
}

const inputCls = "w-full bg-gray-50 border border-gray-200 rounded-lg px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
const inputSmCls = "bg-gray-50 border border-gray-200 rounded-lg px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"

function BlockField({ block, onChange }: { block: BlockType; onChange: (b: BlockType) => void }) {
  switch (block.type) {
    case 'tag':
      return (
        <input
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
          value={block.text}
          onChange={e => onChange({ ...block, text: e.target.value })}
          placeholder="TAG TEXT"
        />
      )

    case 'headline':
      return (
        <div className="space-y-1">
          <textarea
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            rows={2}
            value={block.text}
            onChange={e => onChange({ ...block, text: e.target.value })}
            placeholder="Headline text (use Enter for line breaks)"
          />
          <select
            className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-1.5 py-0.5 focus:outline-none"
            value={block.fontSize || 'lg'}
            onChange={e => onChange({ ...block, fontSize: e.target.value as 'sm' | 'md' | 'lg' })}
          >
            <option value="sm">Small</option>
            <option value="md">Medium</option>
            <option value="lg">Large</option>
          </select>
        </div>
      )

    case 'text':
      return (
        <textarea
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
          rows={3}
          value={block.text}
          onChange={e => onChange({ ...block, text: e.target.value })}
          placeholder="Body text (use Enter for line breaks)"
        />
      )

    case 'steps':
    case 'bullets': {
      const items = block.items
      return (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 w-4 shrink-0">{block.type === 'steps' ? `${i + 1}.` : '\u2022'}</span>
              <input
                className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
                value={item}
                onChange={e => {
                  const next = [...items]
                  next[i] = e.target.value
                  onChange({ ...block, items: next })
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-gray-400 hover:text-red-500"
                onClick={() => onChange({ ...block, items: items.filter((_, j) => j !== i) })}
              >
                <Trash size={12} />
              </Button>
            </div>
          ))}
          <button
            className="text-[10px] text-[#F72D5E] hover:underline"
            onClick={() => onChange({ ...block, items: [...items, ''] })}
          >
            + Add item
          </button>
        </div>
      )
    }

    case 'metric':
      return (
        <div className="flex gap-2">
          <input
            className="w-20 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            value={block.value}
            onChange={e => onChange({ ...block, value: e.target.value })}
            placeholder="95%"
          />
          <input
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            value={block.label}
            onChange={e => onChange({ ...block, label: e.target.value })}
            placeholder="Label"
          />
        </div>
      )

    case 'quote':
      return (
        <div className="space-y-1">
          <textarea
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs italic resize-none focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            rows={2}
            value={block.text}
            onChange={e => onChange({ ...block, text: e.target.value })}
            placeholder="Quote text"
          />
          <input
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            value={block.author || ''}
            onChange={e => onChange({ ...block, author: e.target.value })}
            placeholder="Author (optional)"
          />
        </div>
      )

    case 'spacer':
      return (
        <input
          type="number"
          className="w-20 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
          value={block.height || 20}
          onChange={e => onChange({ ...block, height: parseInt(e.target.value) || 20 })}
          min={4}
          max={80}
        />
      )

    case 'divider':
      return <div className="border-t border-gray-200 my-1" />

    case 'table': {
      const { headers, rows } = block
      return (
        <div className="space-y-2">
          {/* Headers */}
          <div className="space-y-1">
            <span className="text-[10px] text-gray-400">Headers</span>
            <div className="flex gap-1 flex-wrap">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-0.5">
                  <input
                    className={cn(inputSmCls, "w-20 font-semibold")}
                    value={h}
                    onChange={e => {
                      const next = [...headers]
                      next[i] = e.target.value
                      onChange({ ...block, headers: next })
                    }}
                  />
                  <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-gray-400 hover:text-red-500" onClick={() => {
                    onChange({ ...block, headers: headers.filter((_, j) => j !== i), rows: rows.map(r => r.filter((_, j) => j !== i)) })
                  }}><Trash size={8} /></Button>
                </div>
              ))}
              <button className="text-[10px] text-[#F72D5E] hover:underline" onClick={() => {
                onChange({ ...block, headers: [...headers, 'Column'], rows: rows.map(r => [...r, '']) })
              }}>+ Col</button>
            </div>
          </div>
          {/* Rows */}
          <div className="space-y-1">
            <span className="text-[10px] text-gray-400">Rows</span>
            {rows.map((row, ri) => (
              <div key={ri} className="flex items-center gap-1">
                {row.map((cell, ci) => (
                  <input
                    key={ci}
                    className={cn(inputSmCls, "flex-1 min-w-0")}
                    value={cell}
                    onChange={e => {
                      const nextRows = rows.map(r => [...r])
                      nextRows[ri][ci] = e.target.value
                      onChange({ ...block, rows: nextRows })
                    }}
                  />
                ))}
                <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-gray-400 hover:text-red-500 shrink-0" onClick={() => {
                  onChange({ ...block, rows: rows.filter((_, j) => j !== ri) })
                }}><Trash size={8} /></Button>
              </div>
            ))}
            <button className="text-[10px] text-[#F72D5E] hover:underline" onClick={() => {
              onChange({ ...block, rows: [...rows, headers.map(() => '')] })
            }}>+ Row</button>
          </div>
          {/* Caption */}
          <input
            className={cn(inputCls)}
            value={block.caption || ''}
            onChange={e => onChange({ ...block, caption: e.target.value })}
            placeholder="Caption (optional)"
          />
        </div>
      )
    }

    case 'progress':
      return (
        <div className="space-y-1.5">
          <input
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            value={block.label}
            onChange={e => onChange({ ...block, label: e.target.value })}
            placeholder="Label"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <span className="text-[10px] text-gray-400">Value</span>
              <input
                type="number"
                className={cn(inputCls)}
                value={block.value}
                onChange={e => onChange({ ...block, value: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="flex-1">
              <span className="text-[10px] text-gray-400">Target</span>
              <input
                type="number"
                className={cn(inputCls)}
                value={block.target}
                onChange={e => onChange({ ...block, target: parseInt(e.target.value) || 100 })}
              />
            </div>
            <div className="w-14">
              <span className="text-[10px] text-gray-400">Unit</span>
              <input
                className={cn(inputSmCls, "w-full")}
                value={block.unit || ''}
                onChange={e => onChange({ ...block, unit: e.target.value })}
                placeholder="%"
              />
            </div>
          </div>
        </div>
      )

    case 'screenshot':
      return (
        <div className="space-y-1.5">
          <input
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            value={block.url}
            onChange={e => onChange({ ...block, url: e.target.value })}
            placeholder="Image URL (https://...)"
          />
          <input
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            value={block.alt || ''}
            onChange={e => onChange({ ...block, alt: e.target.value })}
            placeholder="Alt text (optional)"
          />
        </div>
      )

    // =============================================
    // Artwork Block Editors
    // =============================================

    case 'artworkShowcase':
      return (
        <div className="space-y-1.5">
          <input
            className={inputCls}
            value={block.artworkTitle}
            onChange={e => onChange({ ...block, artworkTitle: e.target.value })}
            placeholder="Artwork title"
          />
          <input
            className={inputCls}
            value={block.artistName}
            onChange={e => onChange({ ...block, artistName: e.target.value })}
            placeholder="Artist name"
          />
          <input
            className={inputCls}
            value={block.imageUrl}
            onChange={e => onChange({ ...block, imageUrl: e.target.value })}
            placeholder="Image URL (https://...)"
          />
          <input
            className={inputCls}
            value={block.topicTitle || ''}
            onChange={e => onChange({ ...block, topicTitle: e.target.value })}
            placeholder="Topic / collection label (optional)"
          />
        </div>
      )

    case 'artistCredit':
      return (
        <div className="space-y-1.5">
          <input
            className={inputCls}
            value={block.artistName}
            onChange={e => onChange({ ...block, artistName: e.target.value })}
            placeholder="Artist name"
          />
          <textarea
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-1.5 py-1 text-[10px] resize-none focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            rows={2}
            value={block.bio}
            onChange={e => onChange({ ...block, bio: e.target.value })}
            placeholder="Bio snippet"
          />
          <input
            className={inputCls}
            value={block.imageUrl}
            onChange={e => onChange({ ...block, imageUrl: e.target.value })}
            placeholder="Artist photo URL (optional)"
          />
        </div>
      )

    case 'editionInfo':
      return (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <div className="flex-1">
              <span className="text-[10px] text-gray-400">Edition size</span>
              <input
                type="number"
                className={cn(inputCls)}
                value={block.editionSize}
                onChange={e => onChange({ ...block, editionSize: parseInt(e.target.value) || 0 })}
                min={1}
              />
            </div>
            <div className="flex-1">
              <span className="text-[10px] text-gray-400">Sold</span>
              <input
                type="number"
                className={cn(inputCls)}
                value={block.editionSold}
                onChange={e => onChange({ ...block, editionSold: parseInt(e.target.value) || 0 })}
                min={0}
              />
            </div>
          </div>
          <div>
            <span className="text-[10px] text-gray-400">Status</span>
            <select
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
              value={block.status}
              onChange={e => onChange({ ...block, status: e.target.value })}
            >
              <option value="available">Available</option>
              <option value="limited">Limited</option>
              <option value="sold_out">Sold Out</option>
              <option value="coming_soon">Coming Soon</option>
            </select>
          </div>
        </div>
      )

    case 'priceDisplay':
      return (
        <div className="space-y-1.5">
          <input
            className={inputCls}
            value={block.price}
            onChange={e => onChange({ ...block, price: e.target.value })}
            placeholder="Price (e.g. $250)"
          />
          <input
            className={inputCls}
            value={block.cta}
            onChange={e => onChange({ ...block, cta: e.target.value })}
            placeholder="CTA text (e.g. Shop at artinscale.com)"
          />
          <input
            className={inputCls}
            value={block.shopifyHandle}
            onChange={e => onChange({ ...block, shopifyHandle: e.target.value })}
            placeholder="Shopify handle (optional)"
          />
        </div>
      )

    default:
      return null
  }
}

export function BlockEditor({ blocks, onChange }: BlockEditorProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  const moveBlock = (index: number, direction: -1 | 1) => {
    const next = [...blocks]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const removeBlock = (index: number) => {
    onChange(blocks.filter((_, i) => i !== index))
  }

  const updateBlock = (index: number, block: BlockType) => {
    const next = [...blocks]
    next[index] = block
    onChange(next)
  }

  const addBlock = (type: string) => {
    const def = BLOCK_TYPES.find(b => b.type === type)
    if (!def) return
    onChange([...blocks, { ...def.defaultValue } as BlockType])
    setAddMenuOpen(false)
  }

  return (
    <div className="space-y-2.5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
        Content Blocks
      </div>

      {blocks.map((block, i) => (
        <div key={i} className="group border border-gray-200 rounded-xl p-3 bg-white hover:border-gray-300 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <Badge variant="default" size="sm" className="text-[10px] uppercase tracking-wider">
              {BLOCK_TYPES.find(b => b.type === block.type)?.label || block.type}
            </Badge>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => moveBlock(i, -1)} disabled={i === 0}>
                <ArrowUp size={12} />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => moveBlock(i, 1)} disabled={i === blocks.length - 1}>
                <ArrowDown size={12} />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:text-red-400 hover:bg-red-500/10" onClick={() => removeBlock(i)}>
                <Trash size={12} />
              </Button>
            </div>
          </div>
          <BlockField block={block} onChange={b => updateBlock(i, b)} />
        </div>
      ))}

      {/* Add block */}
      <div className="relative">
        <button
          className="w-full border border-dashed border-gray-300 rounded-xl py-2.5 text-xs text-gray-400 hover:text-[#F72D5E] hover:border-[#F72D5E]/40 transition-all flex items-center justify-center gap-1"
          onClick={() => setAddMenuOpen(!addMenuOpen)}
        >
          <Plus size={14} /> Add Block
        </button>
        {addMenuOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-white/95 backdrop-blur-md border border-gray-200 rounded-xl shadow-xl z-10 p-1.5 max-h-64 overflow-y-auto">
            {BLOCK_TYPES.map(b => (
              <button
                key={b.type}
                className="w-full text-left text-xs px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                onClick={() => addBlock(b.type)}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
