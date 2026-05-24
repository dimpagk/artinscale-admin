/**
 * Meta Graph API publisher.
 *
 * Direct integration with Meta's Content Publishing + Pages APIs for
 * IG and FB posts. Used after a `social_post` is approved and dropped
 * into `posting_schedule` — the publisher worker picks scheduled rows
 * and publishes them via this client.
 *
 * Required env:
 *   - META_GRAPH_ACCESS_TOKEN     long-lived page access token
 *   - META_IG_USER_ID             Instagram Business Account ID
 *   - META_FB_PAGE_ID             Facebook Page ID
 *   - META_GRAPH_API_VERSION      defaults to v18.0
 *
 * Supported launch surfaces:
 *   - Instagram image posts, carousels, and Reels
 *   - Facebook Page image posts
 *
 * Stories are not wired yet (separate API surface).
 *
 * Reference: https://developers.facebook.com/docs/instagram-platform/content-publishing
 */

const API_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v18.0'
const ACCESS_TOKEN = process.env.META_GRAPH_ACCESS_TOKEN
const IG_USER_ID = process.env.META_IG_USER_ID
const FB_PAGE_ID = process.env.META_FB_PAGE_ID

const BASE = `https://graph.facebook.com/${API_VERSION}`

export type MetaPlatform = 'instagram' | 'facebook'

export interface PublishResult {
  externalId: string
  permalink?: string
}

function ensureCreds() {
  if (!ACCESS_TOKEN) {
    throw new Error(
      'META_GRAPH_ACCESS_TOKEN missing. Generate a long-lived Page Access Token in Meta Business Manager.'
    )
  }
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: ACCESS_TOKEN }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meta Graph error ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}

async function getJson<T>(url: string): Promise<T> {
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(`${url}${sep}access_token=${ACCESS_TOKEN}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meta Graph error ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}

/**
 * Publish a single-image IG post (the most common case).
 *
 * Two-step Content Publishing API:
 *   1. POST /{ig-user-id}/media          → returns container id
 *   2. POST /{ig-user-id}/media_publish  → returns media id
 */
export async function publishInstagramImagePost(args: {
  imageUrl: string
  caption: string
}): Promise<PublishResult> {
  ensureCreds()
  if (!IG_USER_ID) {
    throw new Error('META_IG_USER_ID missing.')
  }

  const container = await postJson<{ id: string }>(`${BASE}/${IG_USER_ID}/media`, {
    image_url: args.imageUrl,
    caption: args.caption,
  })

  const published = await postJson<{ id: string }>(
    `${BASE}/${IG_USER_ID}/media_publish`,
    { creation_id: container.id }
  )

  // Try to fetch the permalink (best-effort)
  let permalink: string | undefined
  try {
    const meta = await getJson<{ permalink?: string }>(
      `${BASE}/${published.id}?fields=permalink`
    )
    permalink = meta.permalink
  } catch {
    /* permalink is optional */
  }

  return { externalId: published.id, permalink }
}

/**
 * Publish a single-image FB Page post.
 */
export async function publishFacebookImagePost(args: {
  imageUrl: string
  caption: string
}): Promise<PublishResult> {
  ensureCreds()
  if (!FB_PAGE_ID) {
    throw new Error('META_FB_PAGE_ID missing.')
  }

  const result = await postJson<{ id: string; post_id?: string }>(
    `${BASE}/${FB_PAGE_ID}/photos`,
    {
      url: args.imageUrl,
      caption: args.caption,
      published: true,
    }
  )

  const externalId = result.post_id ?? result.id
  return { externalId, permalink: undefined }
}

/**
 * Publish an IG carousel.
 *
 * Three-step flow:
 *   1. Per child image: POST /{ig-user-id}/media with
 *      `is_carousel_item: true, image_url: <url>` → child container id
 *   2. Parent container: POST /{ig-user-id}/media with
 *      `media_type: CAROUSEL, children: [...ids], caption`
 *   3. POST /{ig-user-id}/media_publish with `creation_id: <parent>`
 *
 * Min 2 / max 10 child items per IG carousel.
 */
export async function publishInstagramCarousel(args: {
  imageUrls: string[]
  caption: string
}): Promise<PublishResult> {
  ensureCreds()
  if (!IG_USER_ID) {
    throw new Error('META_IG_USER_ID missing.')
  }
  if (args.imageUrls.length < 2) {
    throw new Error('IG carousel requires at least 2 child images.')
  }
  if (args.imageUrls.length > 10) {
    throw new Error('IG carousel accepts at most 10 child images.')
  }

  const childIds: string[] = []
  for (const url of args.imageUrls) {
    const child = await postJson<{ id: string }>(`${BASE}/${IG_USER_ID}/media`, {
      image_url: url,
      is_carousel_item: true,
    })
    childIds.push(child.id)
  }

  const parent = await postJson<{ id: string }>(`${BASE}/${IG_USER_ID}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: args.caption,
  })

  const published = await postJson<{ id: string }>(
    `${BASE}/${IG_USER_ID}/media_publish`,
    { creation_id: parent.id }
  )

  let permalink: string | undefined
  try {
    const meta = await getJson<{ permalink?: string }>(
      `${BASE}/${published.id}?fields=permalink`
    )
    permalink = meta.permalink
  } catch {
    /* permalink optional */
  }

  return { externalId: published.id, permalink }
}

/**
 * Publish an IG Reel.
 *
 * Resumable flow:
 *   1. POST /{ig-user-id}/media with `media_type: REELS, video_url, caption,
 *      share_to_feed: true` → returns container id
 *   2. Poll GET /{container-id}?fields=status_code until FINISHED
 *      (or ERROR / EXPIRED). Times out after ~90s — Reels with longer
 *      processing windows must be retried by the caller.
 *   3. POST /{ig-user-id}/media_publish with the container id.
 *
 * The 90s cap is intentional: a long synchronous wait blocks the worker.
 * Posting worker retries on next tick if we throw, but each retry restarts
 * from scratch — for now this is acceptable. Move to async polling once
 * Reels become a routine part of the catalogue.
 */
export async function publishInstagramReel(args: {
  videoUrl: string
  caption: string
}): Promise<PublishResult> {
  ensureCreds()
  if (!IG_USER_ID) {
    throw new Error('META_IG_USER_ID missing.')
  }

  const container = await postJson<{ id: string }>(`${BASE}/${IG_USER_ID}/media`, {
    media_type: 'REELS',
    video_url: args.videoUrl,
    caption: args.caption,
    share_to_feed: true,
  })

  // Poll for FINISHED — Reels need server-side transcoding.
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const status = await getJson<{ status_code?: string; status?: string }>(
      `${BASE}/${container.id}?fields=status_code,status`
    )
    if (status.status_code === 'FINISHED') break
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(
        `Reel container ${container.id} ${status.status_code}: ${status.status ?? '(no detail)'}`
      )
    }
  }

  const published = await postJson<{ id: string }>(
    `${BASE}/${IG_USER_ID}/media_publish`,
    { creation_id: container.id }
  )

  let permalink: string | undefined
  try {
    const meta = await getJson<{ permalink?: string }>(
      `${BASE}/${published.id}?fields=permalink`
    )
    permalink = meta.permalink
  } catch {
    /* permalink optional */
  }

  return { externalId: published.id, permalink }
}

/**
 * Top-level dispatch used by the worker. Picks the right method
 * based on platform + post_type.
 */
export async function publishSocialPost(args: {
  platform: MetaPlatform
  postType: 'single' | 'carousel' | 'reel'
  imageUrls: string[]
  videoUrl?: string
  caption: string
}): Promise<PublishResult> {
  if (args.platform === 'instagram') {
    if (args.postType === 'single') {
      const url = args.imageUrls[0]
      if (!url) throw new Error('Single post requires at least one image URL.')
      return publishInstagramImagePost({ imageUrl: url, caption: args.caption })
    }
    if (args.postType === 'carousel') {
      return publishInstagramCarousel({
        imageUrls: args.imageUrls,
        caption: args.caption,
      })
    }
    if (args.postType === 'reel') {
      if (!args.videoUrl) throw new Error('Reel requires a videoUrl.')
      return publishInstagramReel({ videoUrl: args.videoUrl, caption: args.caption })
    }
    throw new Error(`Unsupported IG post_type: ${args.postType}`)
  }

  if (args.platform === 'facebook') {
    const url = args.imageUrls[0]
    if (!url) throw new Error('FB post requires at least one image URL.')
    return publishFacebookImagePost({ imageUrl: url, caption: args.caption })
  }

  throw new Error(`Unsupported platform: ${args.platform}`)
}
