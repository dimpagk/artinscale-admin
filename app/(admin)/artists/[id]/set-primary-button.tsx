'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { setPrimaryStylePackAction } from './actions'

interface SetPrimaryButtonProps {
  artistId: string
  packId: string
}

export function SetPrimaryButton({ artistId, packId }: SetPrimaryButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleClick = () => {
    setError(null)
    startTransition(async () => {
      try {
        await setPrimaryStylePackAction({ artistId, packId })
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to set primary')
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        loading={pending}
        disabled={pending}
        title="Make this the artist's primary voice — it will drive downstream agents"
      >
        Set primary
      </Button>
    </div>
  )
}
