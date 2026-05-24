import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Fetch approved + public contributions for a topic, formatted as
 * generator-ready creative context. Used by the AI Art Generator to
 * auto-populate the contribution context textarea — replacing the
 * manual paste step.
 *
 * GET /api/topics/{id}/contributions?limit=5
 *
 * Returns:
 *   {
 *     count: number,
 *     formatted: string,                  // ready to inject into prompts
 *     contributions: ContributionRow[]    // raw rows, in case the UI wants to render them differently
 *   }
 */

interface ContributionRow {
  id: string
  type: 'story' | 'photo' | 'sound' | 'link'
  contributor_name: string
  contributor_location: string | null
  content: string
  caption: string | null
  source: 'community' | 'studio_seed' | null
}

function formatContributions(rows: ContributionRow[]): string {
  if (rows.length === 0) {
    return ''
  }
  return rows
    .map((row) => {
      const where = row.contributor_location ? ` (${row.contributor_location})` : ''
      const isStory = row.type === 'story'
      const text = isStory ? row.content : row.caption ?? ''
      const trimmed = (text ?? '').trim().slice(0, 280)
      if (!trimmed) return null
      const tag = row.source === 'studio_seed' ? ' [seed]' : ''
      return `${row.contributor_name}${where}${tag}: "${trimmed}"`
    })
    .filter(Boolean)
    .join('\n\n')
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = new URL(request.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '5'), 10)

  const { data, error } = await supabaseAdmin
    .from('topic_contributions')
    .select('id, type, contributor_name, contributor_location, content, caption, source')
    .eq('topic_id', id)
    .eq('status', 'approved')
    .eq('show_publicly', true)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json(
      { error: `query failed: ${error.message}` },
      { status: 500 }
    )
  }

  const rows = (data ?? []) as ContributionRow[]
  return NextResponse.json({
    count: rows.length,
    formatted: formatContributions(rows),
    contributions: rows,
  })
}
