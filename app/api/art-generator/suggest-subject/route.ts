import { NextResponse } from 'next/server'
import { suggestSubjectFromContext } from '@/lib/agents/subject-suggester'

/**
 * Derive a concrete subject from a topic's contribution context, for the
 * art generator's "leave the subject blank" flow. The client calls this
 * once before a variation batch when the operator hasn't typed a subject,
 * then feeds the result in as the subject so every variation shares it
 * and it gets stored on the image record.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const contributionContext =
      typeof body.contributionContext === 'string'
        ? body.contributionContext.trim()
        : ''

    if (!contributionContext) {
      return NextResponse.json(
        { error: 'contributionContext is required to derive a subject' },
        { status: 400 }
      )
    }

    const subject = await suggestSubjectFromContext({
      contributionContext,
      artistTagline:
        typeof body.artistTagline === 'string' ? body.artistTagline : null,
    })

    if (!subject) {
      return NextResponse.json(
        { error: 'Could not derive a subject from the context' },
        { status: 502 }
      )
    }

    return NextResponse.json({ subject })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[suggest-subject] failed:', message)
    return NextResponse.json(
      { error: `Failed to derive subject: ${message}` },
      { status: 500 }
    )
  }
}
