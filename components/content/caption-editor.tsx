'use client'

import { useState } from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'

interface CaptionEditorProps {
  caption: string
  onChange: (caption: string) => void
}

export function CaptionEditor({ caption, onChange }: CaptionEditorProps) {
  const [copied, setCopied] = useState(false)

  const charCount = caption.length
  const hashtagCount = (caption.match(/#\w+/g) || []).length

  const handleCopy = () => {
    navigator.clipboard.writeText(caption).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Caption
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={!caption}
          icon={copied ? <Check size={10} /> : <Copy size={10} />}
          className="h-6 text-[10px] font-semibold px-2.5 bg-[#F72D5E]/10 text-[#F72D5E] hover:bg-[#F72D5E]/20"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <textarea
        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30 placeholder:text-gray-300"
        rows={6}
        value={caption}
        onChange={e => onChange(e.target.value)}
        placeholder="Write your Instagram caption here..."
        maxLength={2200}
      />

      <div className="flex items-center gap-3 text-[10px] text-gray-400">
        <span className={charCount > 2000 ? 'text-red-500' : ''}>
          {charCount} / 2,200
        </span>
        <span>{hashtagCount} hashtag{hashtagCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}
