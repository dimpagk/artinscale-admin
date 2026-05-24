/**
 * Queue preview registry — dispatches `<QueuePreview item={...} />` to
 * the right per-item-type renderer. Add a new preview by creating a
 * new file in this directory and registering it below.
 */
import type { ApprovalQueueRow } from '@/lib/queue'
import type { QueuePreviewComponent } from './types'

import { TopicPreview } from './topic-preview'
import { SocialCampaignPreview } from './social-campaign-preview'
import { EmailPreview } from './email-preview'
import { CommentReplyPreview } from './comment-reply-preview'
import { InsightPreview } from './insight-preview'
import { ContributionPreview } from './contribution-preview'
import { JsonPreview } from './json-preview'

const REGISTRY: Partial<Record<ApprovalQueueRow['item_type'], QueuePreviewComponent>> = {
  topic: TopicPreview,
  social_campaign: SocialCampaignPreview,
  email: EmailPreview,
  comment_reply: CommentReplyPreview,
  insight: InsightPreview,
  contribution: ContributionPreview,
}

export function QueuePreview({ item }: { item: ApprovalQueueRow }) {
  const Component = REGISTRY[item.item_type] ?? JsonPreview
  return <Component item={item} />
}

export type { QueuePreviewProps, QueuePreviewComponent } from './types'
