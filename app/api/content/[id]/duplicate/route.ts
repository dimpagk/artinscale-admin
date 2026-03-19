import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Duplicate a social post as a new draft.
 * POST /api/content/[id]/duplicate
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // Fetch original
    const { data: original, error: fetchError } = await supabaseAdmin
      .from('social_posts')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (fetchError || !original) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Insert copy as draft
    const { data: copy, error: insertError } = await supabaseAdmin
      .from('social_posts')
      .insert({
        title: original.title ? `Copy of ${original.title}` : 'Untitled Copy',
        platform: original.platform,
        post_type: original.post_type,
        visual_config: original.visual_config,
        caption: original.caption,
        status: 'draft',
        scheduled_for: null,
        tags: original.tags,
        artwork_id: original.artwork_id,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error duplicating post:', insertError)
      return NextResponse.json({ error: 'Failed to duplicate post' }, { status: 500 })
    }

    return NextResponse.json({ post: copy }, { status: 201 })
  } catch (error) {
    console.error('Content duplicate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
