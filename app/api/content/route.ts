import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Content Studio API
 * POST /api/content — Create a new social post
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { title, platform, post_type, visual_config, caption, status, scheduled_for, tags, artwork_id } = body

    if (!visual_config) {
      return NextResponse.json({ error: 'visual_config is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('social_posts')
      .insert({
        title: title || null,
        platform: platform || 'instagram',
        post_type: post_type || 'single',
        visual_config,
        caption: caption || null,
        status: status || 'draft',
        scheduled_for: scheduled_for || null,
        tags: tags || [],
        artwork_id: artwork_id || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating social post:', error)
      return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
    }

    return NextResponse.json({ post: data }, { status: 201 })
  } catch (error) {
    console.error('Content create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
