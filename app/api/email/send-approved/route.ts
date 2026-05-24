import { NextResponse } from 'next/server'
import { getQueueItem } from '@/lib/queue'
import { sendEmail } from '@/lib/email/resend'

/**
 * Send an approved email draft from the queue.
 *
 * POST /api/email/send-approved   body: { queueItemId: string }
 *
 * The queue item must:
 *   - have item_type='email'
 *   - status='approved'
 *
 * On success the email is sent via Resend; the queue item is left
 * approved (the operator can read the audit trail). For send retries
 * on failure, post again — Resend has its own dedup via `idempotency_key`
 * which we'll wire if the volume needs it.
 */

const TRIGGER_TOKEN = process.env.AGENT_TRIGGER_TOKEN

function checkAuth(request: Request): NextResponse | null {
  if (!TRIGGER_TOKEN) {
    const url = new URL(request.url)
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0'
    ) {
      return null
    }
    return NextResponse.json({ error: 'AGENT_TRIGGER_TOKEN required.' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${TRIGGER_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function POST(request: Request) {
  const authError = checkAuth(request)
  if (authError) return authError

  let body: { queueItemId?: string }
  try {
    body = (await request.json()) as { queueItemId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.queueItemId) {
    return NextResponse.json({ error: 'queueItemId required' }, { status: 400 })
  }

  const item = await getQueueItem(body.queueItemId)
  if (!item) {
    return NextResponse.json({ error: 'Queue item not found' }, { status: 404 })
  }
  if (item.item_type !== 'email') {
    return NextResponse.json(
      { error: `Queue item is not an email (item_type=${item.item_type})` },
      { status: 400 }
    )
  }
  if (item.status !== 'approved' && item.status !== 'edited' && item.status !== 'auto_approved') {
    return NextResponse.json(
      { error: `Queue item must be approved before sending (status=${item.status})` },
      { status: 400 }
    )
  }

  const payload = item.payload as {
    to?: string | string[]
    subject?: string
    html?: string
    text?: string
  }
  if (!payload.to || !payload.subject || !payload.html) {
    return NextResponse.json(
      { error: 'Queue payload missing one of: to, subject, html' },
      { status: 400 }
    )
  }

  try {
    const result = await sendEmail({
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      tags: [
        { name: 'queue_item', value: item.id },
        { name: 'agent', value: item.source_agent },
      ],
    })
    return NextResponse.json({ ok: true, sendId: result.id, isDryRun: result.isDryRun ?? false })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
