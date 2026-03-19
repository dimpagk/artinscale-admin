import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Artwork } from '@/lib/types'

export interface ArtworkWithJoins extends Artwork {
  users: {
    id: string
    name: string | null
    image: string | null
    bio: string | null
  } | null
  topics: {
    id: string
    title: string
  } | null
}

export async function getArtworks(): Promise<ArtworkWithJoins[]> {
  const { data, error } = await supabaseAdmin
    .from('artworks')
    .select('*, users(id, name, image, bio), topics(id, title)')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching artworks:', error)
    return []
  }

  return (data ?? []) as ArtworkWithJoins[]
}

export async function getArtworkById(id: string): Promise<ArtworkWithJoins | null> {
  const { data, error } = await supabaseAdmin
    .from('artworks')
    .select('*, users(id, name, image, bio), topics(id, title)')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching artwork:', error)
    return null
  }

  return data as ArtworkWithJoins
}

export async function searchArtworks(query: string): Promise<ArtworkWithJoins[]> {
  const { data, error } = await supabaseAdmin
    .from('artworks')
    .select('*, users(id, name, image, bio), topics(id, title)')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error searching artworks:', error)
    return []
  }

  return (data ?? []) as ArtworkWithJoins[]
}

export async function createArtwork(data: {
  title: string
  description?: string | null
  image_url?: string | null
  artist_id?: string | null
  topic_id?: string | null
  status?: string
  edition_size?: number | null
  edition_sold?: number
  price?: number | null
  currency?: string
  product_type?: string | null
  creation_date?: string | null
  inspiration_summary?: string | null
}) {
  const { error } = await supabaseAdmin.from('artworks').insert({
    title: data.title,
    description: data.description || null,
    image_url: data.image_url || null,
    artist_id: data.artist_id || null,
    topic_id: data.topic_id || null,
    status: data.status || 'created',
    edition_size: data.edition_size ?? null,
    edition_sold: data.edition_sold ?? 0,
    price: data.price ?? null,
    currency: data.currency || 'EUR',
    product_type: data.product_type || null,
    creation_date: data.creation_date || null,
    inspiration_summary: data.inspiration_summary || null,
  })

  if (error) throw error
}

export async function updateArtwork(
  id: string,
  data: {
    title?: string
    description?: string | null
    image_url?: string | null
    artist_id?: string | null
    topic_id?: string | null
    status?: string
    edition_size?: number | null
    edition_sold?: number
    price?: number | null
    currency?: string
    product_type?: string | null
    creation_date?: string | null
    inspiration_summary?: string | null
    gelato_product_id?: string | null
    gelato_store_id?: string | null
    shopify_product_id?: string | null
    shopify_handle?: string | null
  }
) {
  const { error } = await supabaseAdmin.from('artworks').update(data).eq('id', id)
  if (error) throw error
}

export async function deleteArtwork(id: string) {
  const { error } = await supabaseAdmin.from('artworks').delete().eq('id', id)
  if (error) throw error
}
