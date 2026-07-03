'use client'

import type { ReactNode } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

/**
 * Standardized "Are you sure you want to delete X" confirmation modal.
 * Replaces the inline Modal+message+actions pattern in every form.
 */
interface DeleteConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  /** Imperative title — defaults to "Delete {entity}". */
  title?: string
  /** Domain noun used in default copy. Required if `title` is omitted. */
  entity?: string
  /** Specific item being deleted, rendered in bold. */
  itemName?: string
  /** Override the body. Defaults to a sensible "Are you sure" sentence using entity + itemName. */
  body?: ReactNode
  /** Action label. Defaults to "Delete {entity}". */
  confirmLabel?: string
  /** Side-effects warning, optional. */
  cascade?: ReactNode
  onConfirm: () => void
  /** Whether the confirm button is in a loading state. */
  pending?: boolean
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  title,
  entity,
  itemName,
  body,
  confirmLabel,
  cascade,
  onConfirm,
  pending = false,
}: DeleteConfirmModalProps) {
  const resolvedTitle = title ?? (entity ? `Delete ${entity}` : 'Confirm delete')
  const resolvedConfirmLabel = confirmLabel ?? (entity ? `Delete ${entity}` : 'Delete')
  const resolvedBody =
    body ??
    (itemName ? (
      <>
        Are you sure you want to delete <strong>{itemName}</strong>? This
        action cannot be undone.
      </>
    ) : (
      <>Are you sure you want to delete this item? This action cannot be undone.</>
    ))

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={resolvedTitle}
      actions={
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={pending}
            className="border-gray-300 bg-white hover:bg-gray-100"
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onConfirm}
            loading={pending}
            disabled={pending}
          >
            {resolvedConfirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-gray-600">{resolvedBody}</p>
      {cascade && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {cascade}
        </p>
      )}
    </Modal>
  )
}
