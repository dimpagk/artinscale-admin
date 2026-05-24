/**
 * Email drafter.
 *
 * Drafts welcome / abandoned-cart / drop-announcement emails into
 * approval_queue (item_type='email'). The operator approves; an
 * approved email is sent via /api/email/send-approved which calls
 * the Resend client.
 *
 * For drop-announcement emails the agent fetches the artwork +
 * artist + topic context. For welcome / abandoned-cart, it just
 * picks the right template and fills in the personalization fields.
 */

import { startAgentTask, finishAgentTask } from './base'
import { enqueueDraft } from '@/lib/queue'
import {
  welcomeEmail,
  abandonedCartEmail,
  dropAnnouncementEmail,
  weeklyDigestEmail,
} from '@/lib/email/resend'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getStylePackForArtistAsync } from '@/lib/style-packs/server'

export type EmailKind = 'welcome' | 'abandoned_cart' | 'drop_announcement' | 'weekly_digest'

export interface EmailDraft {
  kind: EmailKind
  to: string | string[]
  subject: string
  html: string
  text?: string
  context: Record<string, unknown>
}

export async function draftWelcomeEmail(args: {
  to: string
  firstName?: string
  storefrontUrl: string
}) {
  return draftEmail({
    kind: 'welcome',
    triggerKey: `welcome-${args.to}`,
    build: () => welcomeEmail({ firstName: args.firstName, storefrontUrl: args.storefrontUrl }),
    payload: (built) => ({
      kind: 'welcome',
      to: args.to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      context: { firstName: args.firstName ?? null },
    }),
  })
}

export async function draftAbandonedCartEmail(args: {
  to: string
  firstName?: string
  productTitle: string
  productUrl: string
  imageUrl?: string
}) {
  return draftEmail({
    kind: 'abandoned_cart',
    triggerKey: `abandoned-${args.to}-${args.productUrl}`,
    build: () =>
      abandonedCartEmail({
        firstName: args.firstName,
        productTitle: args.productTitle,
        productUrl: args.productUrl,
        imageUrl: args.imageUrl,
      }),
    payload: (built) => ({
      kind: 'abandoned_cart',
      to: args.to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      context: { productTitle: args.productTitle },
    }),
  })
}

export async function draftDropAnnouncementEmail(args: {
  to: string | string[]
  artworkId: string
  storefrontUrl: string
}) {
  const { data: artwork } = await supabaseAdmin
    .from('artworks')
    .select('id, title, shopify_handle, image_url, artist_id, topic_id')
    .eq('id', args.artworkId)
    .maybeSingle()

  if (!artwork) throw new Error(`artwork ${args.artworkId} not found`)
  const a = artwork as {
    id: string
    title: string
    shopify_handle: string | null
    image_url: string | null
    artist_id: string | null
    topic_id: string | null
  }

  if (!a.shopify_handle) {
    throw new Error('artwork has no shopify_handle yet — cannot draft a drop email until it is listed')
  }

  let artistName = 'an ArtInScale artist'
  let artistTagline: string | undefined
  if (a.artist_id) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('name')
      .eq('id', a.artist_id)
      .maybeSingle()
    artistName = (user as { name?: string } | null)?.name ?? artistName

    const pack = await getStylePackForArtistAsync(a.artist_id)
    artistTagline = pack?.persona.tagline
  }

  let topicTitle: string | undefined
  let contributionExcerpt: string | undefined
  if (a.topic_id) {
    const { data: topic } = await supabaseAdmin
      .from('topics')
      .select('title')
      .eq('id', a.topic_id)
      .maybeSingle()
    topicTitle = (topic as { title?: string } | null)?.title

    const { data: contributions } = await supabaseAdmin
      .from('topic_contributions')
      .select('content, caption, type')
      .eq('topic_id', a.topic_id)
      .eq('status', 'approved')
      .eq('show_publicly', true)
      .limit(1)

    const c = (contributions ?? [])[0] as { content?: string; caption?: string; type?: string } | undefined
    if (c) {
      contributionExcerpt = c.type === 'story' ? c.content?.slice(0, 220) : c.caption ?? undefined
    }
  }

  const productUrl = `${args.storefrontUrl}/product/${a.shopify_handle}`

  return draftEmail({
    kind: 'drop_announcement',
    triggerKey: `drop-${a.id}`,
    build: () =>
      dropAnnouncementEmail({
        artworkTitle: a.title,
        artistName,
        artistTagline,
        topicTitle,
        productUrl,
        imageUrl: a.image_url ?? undefined,
        contributionExcerpt,
      }),
    payload: (built) => ({
      kind: 'drop_announcement',
      to: args.to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      context: {
        artworkId: a.id,
        artworkTitle: a.title,
        productUrl,
        topicTitle,
      },
    }),
    relatedArtworkId: a.id,
    relatedTopicId: a.topic_id,
  })
}

export async function draftWeeklyDigestEmail(args: {
  to: string | string[]
  storefrontUrl: string
}) {
  // Pull pieces newly listed in the past 7 days
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data: artworks } = await supabaseAdmin
    .from('artworks')
    .select('id, title, shopify_handle, artist_id, users(name)')
    .eq('status', 'listed')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(8)

  const newArtworks = (artworks ?? [])
    .map((row) => {
      const r = row as {
        title: string
        shopify_handle: string | null
        users: { name?: string } | null
      }
      if (!r.shopify_handle) return null
      return {
        title: r.title,
        artist: r.users?.name ?? 'ArtInScale artist',
        url: `${args.storefrontUrl}/product/${r.shopify_handle}`,
      }
    })
    .filter((x): x is { title: string; artist: string; url: string } => !!x)

  return draftEmail({
    kind: 'weekly_digest',
    triggerKey: `digest-${new Date().toISOString().slice(0, 10)}`,
    build: () => {
      const built = weeklyDigestEmail({ newArtworks, storefrontUrl: args.storefrontUrl })
      return { ...built, text: undefined }
    },
    payload: (built) => ({
      kind: 'weekly_digest',
      to: args.to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      context: { newCount: newArtworks.length },
    }),
  })
}

async function draftEmail(args: {
  kind: EmailKind
  triggerKey: string
  build: () => { subject: string; html: string; text?: string }
  payload: (built: { subject: string; html: string; text?: string }) => EmailDraft
  relatedArtworkId?: string | null
  relatedTopicId?: string | null
}): Promise<{ approvalQueueId: string } | { skipped: 'already_running' }> {
  const task = await startAgentTask({
    agentName: `email_drafter_${args.kind}`,
    triggerKind: 'event',
    triggerKey: args.triggerKey,
    input: { kind: args.kind },
  })

  if (!task) return { skipped: 'already_running' }

  try {
    const built = args.build()
    const payload = args.payload(built)

    const queued = await enqueueDraft({
      itemType: 'email',
      payload: payload as unknown as Record<string, unknown>,
      sourceAgent: `email_drafter_${args.kind}`,
      context: { kind: args.kind },
      relatedArtworkId: args.relatedArtworkId ?? null,
      relatedTopicId: args.relatedTopicId ?? null,
    })

    await finishAgentTask(task.id, {
      status: 'succeeded',
      output: { approvalQueueId: queued.id, kind: args.kind },
    })

    return { approvalQueueId: queued.id }
  } catch (err) {
    await finishAgentTask(task.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

