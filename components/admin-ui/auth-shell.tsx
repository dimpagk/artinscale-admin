import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

/**
 * Centered single-column layout used by the login screen and any
 * future credential / verification flows.
 */
interface AuthShellProps {
  title: string
  description?: ReactNode
  children: ReactNode
}

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {description && (
            <p className="mt-2 text-sm text-gray-500">{description}</p>
          )}
        </div>
        <Card>{children}</Card>
      </div>
    </div>
  )
}
