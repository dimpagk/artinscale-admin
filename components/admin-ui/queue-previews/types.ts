import type { ReactElement } from 'react'
import type { ApprovalQueueRow } from '@/lib/queue'

/**
 * Common shape for all queue preview components.
 *
 * Each item_type has its own preview file in this directory. The
 * registry in `index.tsx` dispatches by `item.item_type`. Adding a new
 * item type is a matter of dropping a new file + registering it — no
 * change to the queue page or queue-item parent.
 */
export interface QueuePreviewProps {
  item: ApprovalQueueRow
}

export type QueuePreviewComponent = (props: QueuePreviewProps) => ReactElement
