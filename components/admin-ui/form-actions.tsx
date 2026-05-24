'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * Save / Cancel / Delete row used at the bottom of every admin form.
 *
 * Replaces the duplicated:
 *   <div className="flex items-center gap-3 pt-4">
 *     <Button type="submit">Save</Button>
 *     <Button type="button" variant="ghost" onClick={...}>Cancel</Button>
 *     {isEditing && <Button variant="danger" className="ml-auto" onClick={...}>Delete</Button>}
 *   </div>
 */
interface FormActionsProps {
  /** Submit button label. Defaults to "Save Changes". */
  submitLabel?: string
  /** Whether the submit button is in a loading state. */
  submitting?: boolean
  /** Where Cancel navigates to. */
  cancelHref?: string
  /** Optional override of cancel behavior. If provided, used instead of router.push(cancelHref). */
  onCancel?: () => void
  /** When set, renders a Delete button on the right that fires this callback. */
  onDelete?: () => void
  /** Delete button label. Defaults to "Delete". */
  deleteLabel?: string
  /** Extra slots for additional actions (e.g. "Push to Gelato"). Rendered between Cancel and Delete. */
  extra?: ReactNode
}

export function FormActions({
  submitLabel = 'Save Changes',
  submitting = false,
  cancelHref,
  onCancel,
  onDelete,
  deleteLabel = 'Delete',
  extra,
}: FormActionsProps) {
  const router = useRouter()

  const handleCancel = () => {
    if (onCancel) onCancel()
    else if (cancelHref) router.push(cancelHref)
    else router.back()
  }

  return (
    <div className="flex items-center gap-3 pt-4">
      <Button type="submit" loading={submitting} disabled={submitting}>
        {submitLabel}
      </Button>
      <Button type="button" variant="ghost" onClick={handleCancel}>
        Cancel
      </Button>
      {extra}
      {onDelete && (
        <Button
          type="button"
          variant="danger"
          onClick={onDelete}
          className="ml-auto"
        >
          {deleteLabel}
        </Button>
      )}
    </div>
  )
}
