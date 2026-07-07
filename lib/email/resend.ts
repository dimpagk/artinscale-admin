/**
 * Resend email client + transactional / lifecycle templates.
 *
 * Required env:
 *   - RESEND_API_KEY
 *   - RESEND_FROM_ADDRESS    e.g. 'ArtInScale <hello@artinscale.com>'
 *
 * Triggered by:
 *   - Approved drafts in approval_queue (item_type='email')
 *   - Direct calls from agents (e.g. abandoned cart, drop announcement)
 *
 * Until a paid Resend account + verified sending domain is in place,
 * RESEND_DRY_RUN=true returns mock send IDs and logs instead of sending.
 *
 * Reference: https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM = process.env.RESEND_FROM_ADDRESS ?? 'ArtInScale <hello@artinscale.com>'
const DRY_RUN = process.env.RESEND_DRY_RUN === 'true'

export interface SendEmailArgs {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
  tags?: Array<{ name: string; value: string }>
}

export interface SendResult {
  id: string
  isDryRun?: boolean
}

export async function sendEmail(args: SendEmailArgs): Promise<SendResult> {
  if (DRY_RUN) {
    const id = `dry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    console.log('[Resend] DRY RUN email:', { to: args.to, subject: args.subject, id })
    return { id, isDryRun: true }
  }

  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY missing. Set RESEND_DRY_RUN=true for local testing.')
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: Array.isArray(args.to) ? args.to : [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      reply_to: args.replyTo,
      tags: args.tags,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { id?: string }
  if (!data.id) {
    throw new Error('Resend returned 2xx but no id')
  }
  return { id: data.id }
}

// ============================================
// Templates
//
// Plain HTML, no template engine — keeps the dependency surface tiny.
// Each template returns { subject, html, text } so the caller can pass
// the bundle straight to sendEmail.
// ============================================

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;line-height:1.55;background:#fafaf9;margin:0;padding:24px}
.container{max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee;padding:32px}
h1{font-size:20px;margin:0 0 12px}
a{color:#111;text-decoration:underline}
.muted{color:#666;font-size:13px}
.cta{display:inline-block;background:#111;color:#fff;padding:10px 18px;text-decoration:none;margin-top:8px}
hr{border:0;border-top:1px solid #eee;margin:24px 0}
</style>
</head>
<body>
<div class="container">${body}</div>
<p class="muted" style="text-align:center;margin-top:16px">ArtInScale · Art inspired by people.</p>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export interface WelcomeTemplateArgs {
  firstName?: string
  storefrontUrl: string
}

export function welcomeEmail(args: WelcomeTemplateArgs) {
  const name = args.firstName ? `${args.firstName}, ` : ''
  const subject = 'Welcome to the Collector\'s Circle'
  const html = shell(
    subject,
    `<h1>${name}welcome.</h1>
<p>You've joined the Collector's Circle — early access to new artworks, AI-augmented artists, and the contributions that inspired each piece.</p>
<p><a class="cta" href="${escapeHtml(args.storefrontUrl + '/launch')}">See the Launch Collection</a></p>
<hr/>
<p class="muted">Reply to this email if anything caught your eye — a real person reads each one.</p>`
  )
  const text = `Welcome to the Collector's Circle.\n\nSee the launch collection: ${args.storefrontUrl}/launch`
  return { subject, html, text }
}

export interface AbandonedCartItem {
  title: string
  /** Pre-formatted with currency symbol, e.g. '€59.00'. The template does no currency math. */
  price: string
  /** Print size, e.g. '30 x 40 cm'. Optional. */
  size?: string
  url: string
  imageUrl?: string
}

export interface AbandonedCartTemplateArgs {
  firstName?: string
  items: AbandonedCartItem[]
  /** Link back to the saved checkout / cart so the customer can complete the order. */
  cartUrl: string
}

/**
 * One line item rendered inside a uniform square frame. Every image sits in a
 * fixed 96x96 box with `object-fit:contain` on a neutral background, so pieces
 * of different aspect ratios line up as a consistent set instead of one being
 * full-bleed and another letterboxed. (Outlook desktop ignores object-fit and
 * falls back to a scaled image in the same fixed box, which is still uniform.)
 */
function renderCartItem(item: AbandonedCartItem): string {
  const image = item.imageUrl
    ? `<a href="${escapeHtml(item.url)}" style="text-decoration:none">
      <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" width="96" height="96" style="display:block;width:96px;height:96px;object-fit:contain;background:#f5f5f4;border:1px solid #eee" />
    </a>`
    : `<div style="width:96px;height:96px;background:#f5f5f4;border:1px solid #eee"></div>`
  const size = item.size
    ? `<div style="color:#666;font-size:13px;margin-top:2px">${escapeHtml(item.size)}</div>`
    : ''
  return `<tr>
  <td width="96" valign="top" style="width:96px;padding:0 16px 16px 0">${image}</td>
  <td valign="top" style="padding:0 0 16px 0">
    <div style="font-size:15px;font-weight:600"><a href="${escapeHtml(item.url)}" style="color:#111;text-decoration:none">${escapeHtml(item.title)}</a></div>
    ${size}
    <div style="font-size:14px;margin-top:6px">${escapeHtml(item.price)}</div>
  </td>
</tr>`
}

export function abandonedCartEmail(args: AbandonedCartTemplateArgs) {
  const { items, cartUrl } = args
  const greeting = args.firstName ? `${escapeHtml(args.firstName)}, ` : ''
  const subject =
    items.length === 1 && items[0]
      ? `${items[0].title} is still waiting for you`
      : 'Your selection is still with us'

  const rows = items.map(renderCartItem).join('\n')

  const html = shell(
    subject,
    `<h1>${greeting}your selection is waiting.</h1>
<p>We've kept the pieces you were considering. They're ready whenever you are.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0">
${rows}
</table>
<p><a class="cta" href="${escapeHtml(cartUrl)}">Complete your order</a></p>
<p class="muted">Each print is made to order on archival paper.</p>`
  )

  const textLines = items.map((item) =>
    [item.title, item.size, item.price].filter(Boolean).join(', ')
  )
  const text = [
    items.length === 1 && items[0]
      ? `${items[0].title} is still waiting for you.`
      : 'Your selection is still with us.',
    '',
    ...textLines,
    '',
    `Complete your order: ${cartUrl}`,
  ].join('\n')

  return { subject, html, text }
}

export interface DropAnnouncementTemplateArgs {
  artworkTitle: string
  artistName: string
  artistTagline?: string
  topicTitle?: string
  productUrl: string
  imageUrl?: string
  contributionExcerpt?: string
}

export function dropAnnouncementEmail(args: DropAnnouncementTemplateArgs) {
  const subject = `New: "${args.artworkTitle}" by ${args.artistName}`
  const tagline = args.artistTagline
    ? `<p class="muted" style="font-style:italic">${escapeHtml(args.artistTagline)}</p>`
    : ''
  const topic = args.topicTitle
    ? `<p class="muted">From the topic <strong>${escapeHtml(args.topicTitle)}</strong>.</p>`
    : ''
  const contribution = args.contributionExcerpt
    ? `<blockquote style="border-left:3px solid #ccc;padding:8px 14px;color:#555;margin:12px 0">${escapeHtml(args.contributionExcerpt)}</blockquote>`
    : ''
  const image = args.imageUrl
    ? `<p><img src="${escapeHtml(args.imageUrl)}" alt="${escapeHtml(args.artworkTitle)}" style="max-width:100%;border:1px solid #eee" /></p>`
    : ''
  const html = shell(
    subject,
    `<h1>${escapeHtml(args.artworkTitle)}</h1>
<p>by ${escapeHtml(args.artistName)}</p>
${tagline}
${image}
${topic}
${contribution}
<p><a class="cta" href="${escapeHtml(args.productUrl)}">View the piece</a></p>`
  )
  const text = `New: "${args.artworkTitle}" by ${args.artistName}.\n\nView: ${args.productUrl}`
  return { subject, html, text }
}

export interface DigestTemplateArgs {
  newArtworks: Array<{ title: string; artist: string; url: string }>
  storefrontUrl: string
}

export function weeklyDigestEmail(args: DigestTemplateArgs) {
  const subject = 'New this week at ArtInScale'
  const list = args.newArtworks.length
    ? `<ul>${args.newArtworks
        .map(
          (a) =>
            `<li><a href="${escapeHtml(a.url)}">${escapeHtml(a.title)}</a> — ${escapeHtml(a.artist)}</li>`
        )
        .join('')}</ul>`
    : '<p class="muted">No new pieces this week — but the artists are working.</p>'
  const html = shell(
    subject,
    `<h1>New this week.</h1>
${list}
<p><a class="cta" href="${escapeHtml(args.storefrontUrl + '/launch')}">Visit the launch collection</a></p>`
  )
  return { subject, html }
}
