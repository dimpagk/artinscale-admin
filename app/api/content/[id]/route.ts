import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Content Studio Detail API
 * GET /api/content/[id] — Fetch a social post
 * PATCH /api/content/[id] — Update a social post
 * DELETE /api/content/[id] — Soft delete a social post
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const { data, error } = await supabaseAdmin
      .from('social_posts')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    return NextResponse.json({ post: data })
  } catch (error) {
    console.error('Content get error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Only allow updating known fields
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const allowed = ['title', 'platform', 'post_type', 'visual_config', 'caption', 'status', 'scheduled_for', 'tags', 'artwork_id']
    for (const key of allowed) {
      if (key in body) {
        updates[key] = body[key]
      }
    }

    const { data, error } = await supabaseAdmin
      .from('social_posts')
      .update(updates)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    return NextResponse.json({ post: data })
  } catch (error) {
    console.error('Content update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const { data, error } = await supabaseAdmin
      .from('social_posts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Content delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
