'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { PaperPlaneRight, SpinnerGap, Robot, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ContentCopilotPanelProps {
  postId?: string | null
  onPostUpdated?: () => void
  open: boolean
  onClose: () => void
}

export function ContentCopilotPanel({ postId, onPostUpdated, open, onClose }: ContentCopilotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [threadId] = useState(() => `content-${Date.now()}`)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/content/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId, postId }),
      })

      const data = await res.json()

      if (data.response) {
        setMessages(prev => [...prev, {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.response,
        }])
        if (data.response.includes('Created post') || data.response.includes('Updated post')) {
          onPostUpdated?.()
        }
      } else if (data.error) {
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${data.error}`,
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Failed to reach the copilot. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, threadId, postId, onPostUpdated])

  if (!open) return null

  return (
    <div className="flex flex-col h-full border-l border-gray-200 bg-white/95 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-rose-50 flex items-center justify-center">
            <Robot size={14} className="text-rose-500" />
          </div>
          <span className="text-sm font-semibold">Content Copilot</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
          <X size={14} className="text-gray-500" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-xs mt-8 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center mx-auto">
              <Robot size={20} className="text-rose-500" />
            </div>
            <p className="font-medium text-gray-600">Ask me to create posts, write captions, or plan content.</p>
            <div className="space-y-1.5 text-[10px]">
              <p className="px-3 py-1.5 rounded-lg bg-gray-100 inline-block">&ldquo;Create a post for our new artwork drop&rdquo;</p>
              <br />
              <p className="px-3 py-1.5 rounded-lg bg-gray-100 inline-block">&ldquo;Write a caption for the artist spotlight&rdquo;</p>
              <br />
              <p className="px-3 py-1.5 rounded-lg bg-gray-100 inline-block">&ldquo;Plan a series around our latest topic&rdquo;</p>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-rose-50 text-gray-900'
                : 'bg-gray-100 text-gray-900'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-xl px-3 py-2">
              <SpinnerGap size={14} className="animate-spin text-rose-500" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex items-center gap-2">
          <input
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-rose-300 placeholder:text-gray-400"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask the copilot..."
            disabled={loading}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
          >
            <PaperPlaneRight size={14} weight="bold" />
          </Button>
        </div>
      </div>
    </div>
  )
}
