import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { SocialPost } from '@/lib/constants/content'
import { PostEditorClient } from './post-editor-client'

async function getPost(id: string): Promise<SocialPost | null> {
  const { data, error } = await supabaseAdmin
    .from('social_posts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error || !data) return null
  return data as SocialPost
}

async function getLinkedArtwork(artworkId: string | null) {
  if (!artworkId) return null

  // Join with users table to get artist name
  const { data, error } = await supabaseAdmin
    .from('artworks')
    .select('id, title, edition_size, edition_sold, shopify_handle, artist_id, users(name)')
    .eq('id', artworkId)
    .single()

  if (error || !data) return null

  // Supabase join returns object for single FK, but TS types it as array
  const usersData = data.users as unknown as { name: string | null } | null
  const artistName = usersData?.name || null

  return {
    id: data.id as string,
    title: data.title as string | null,
    artist_name: artistName,
    primary_image_url: null, // No image URL in artworks table — could be fetched from Shopify
    editions_total: data.edition_size as number | null,
    editions_sold: data.edition_sold as number | null,
    price: null,
  }
}

export default async function PostEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const post = await getPost(id)
  if (!post) notFound()

  const linkedArtwork = await getLinkedArtwork(post.artwork_id)

  return <PostEditorClient post={post} linkedArtwork={linkedArtwork} />
}
