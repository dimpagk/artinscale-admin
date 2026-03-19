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
