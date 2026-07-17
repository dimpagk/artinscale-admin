import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Artwork, ListingMeta } from '@/lib/types'

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

/** Whitelist of sortable URL keys → real columns on the artworks table. */
const ARTWORK_SORT_COLUMNS: Record<string, string> = {
  title: 'title',
  status: 'status',
  edition: 'edition_size',
  product_type: 'product_type',
  created: 'created_at',
}

export interface ArtworkListOptions {
  /** Free-text search over title + description. */
  q?: string
  status?: string
  artistId?: string
  topicId?: string
  productType?: string
  /** One of ARTWORK_SORT_COLUMNS keys; unknown values fall back to default order. */
  sort?: string
  dir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface ArtworkListResult {
  rows: ArtworkWithJoins[]
  total: number
  /** Effective page served — may differ from the requested page when a stale link points past the last page. */
  page: number
}

export async function listArtworks(
  options: ArtworkListOptions = {}
): Promise<ArtworkListResult> {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = options.pageSize ?? 20

  const build = (p: number) => {
    let query = supabaseAdmin
      .from('artworks')
      .select('*, users(id, name, image, bio), topics(id, title)', {
        count: 'exact',
      })

    if (options.status) query = query.eq('status', options.status)
    if (options.artistId) query = query.eq('artist_id', options.artistId)
    if (options.topicId) query = query.eq('topic_id', options.topicId)
    if (options.productType) query = query.eq('product_type', options.productType)
    // Commas and parens would break PostgREST's .or() filter syntax.
    const q = options.q?.replace(/[,()]/g, ' ').trim()
    if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`)

    const sortCol = options.sort ? ARTWORK_SORT_COLUMNS[options.sort] : undefined
    if (sortCol) {
      query = query.order(sortCol, {
        ascending: options.dir !== 'desc',
        nullsFirst: false,
      })
    } else {
      query = query.order('created_at', { ascending: false })
    }
    // Unique tiebreaker so pagination stays deterministic when the sort
    // column has ties (or is all-null).
    query = query.order('id', { ascending: false })

    const from = (p - 1) * pageSize
    return query.range(from, from + pageSize - 1)
  }

  let effectivePage = page
  let { data, error, count } = await build(page)

  // A stale page link past the last row makes PostgREST reject the
  // range (or return an empty page) — recover by re-counting and
  // serving the last real page.
  if (error && page > 1) {
    effectivePage = 1
    ;({ data, error, count } = await build(1))
    const lastPage = Math.max(1, Math.ceil((count ?? 0) / pageSize))
    if (!error && lastPage > 1) {
      effectivePage = lastPage
      ;({ data, error, count } = await build(lastPage))
    }
  } else if (!error && page > 1 && (data?.length ?? 0) === 0 && (count ?? 0) > 0) {
    effectivePage = Math.max(1, Math.ceil((count ?? 0) / pageSize))
    ;({ data, error, count } = await build(effectivePage))
  }

  if (error) {
    console.error('Error listing artworks:', error)
    return { rows: [], total: 0, page: 1 }
  }

  return {
    rows: (data ?? []) as ArtworkWithJoins[],
    total: count ?? 0,
    page: effectivePage,
  }
}

/** Distinct product_type values in use, for the list page's type filter. */
export async function getArtworkProductTypes(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('artworks')
    .select('product_type')
    .not('product_type', 'is', null)

  if (error) {
    console.error('Error fetching artwork product types:', error)
    return []
  }

  const types = (data ?? [])
    .map((row) => row.product_type as string)
    .filter(Boolean)
  return [...new Set(types)].sort()
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
  creation_source?: string
  creation_cost?: number | null
  creation_cost_currency?: string
  creation_cost_breakdown?: Record<string, unknown>
}): Promise<string> {
  const { data: created, error } = await supabaseAdmin
    .from('artworks')
    .insert({
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
      ...(data.creation_source ? { creation_source: data.creation_source } : {}),
      ...(data.creation_cost != null ? { creation_cost: data.creation_cost } : {}),
      ...(data.creation_cost_currency
        ? { creation_cost_currency: data.creation_cost_currency }
        : {}),
      ...(data.creation_cost_breakdown
        ? { creation_cost_breakdown: data.creation_cost_breakdown }
        : {}),
    })
    .select('id')
    .single()

  if (error) throw error
  return (created as { id: string }).id
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
    listing_meta?: ListingMeta | null
    creation_source?: string
    creation_cost?: number | null
    creation_cost_currency?: string
    creation_cost_breakdown?: Record<string, unknown>
    unit_production_cost?: number | null
  }
) {
  const { error } = await supabaseAdmin.from('artworks').update(data).eq('id', id)
  if (error) throw error
}

export async function deleteArtwork(id: string) {
  const { error } = await supabaseAdmin.from('artworks').delete().eq('id', id)
  if (error) throw error
}

/**
 * Link a Shopify product handle to a topic via the storefront's
 * `product_topics` table. This is what the public storefront actually
 * reads to render the "Story Behind This Artwork" block on a product
 * page — the admin's local `artworks` table is invisible to it.
 *
 * Idempotent: ON CONFLICT (shopify_handle) DO NOTHING leaves an
 * existing link untouched if the handle is already mapped.
 */
export async function linkProductToTopic(
  shopifyHandle: string,
  topicId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('product_topics')
    .upsert(
      { shopify_handle: shopifyHandle, topic_id: topicId },
      { onConflict: 'shopify_handle', ignoreDuplicates: true }
    )

  if (error) {
    console.error('Error linking product to topic:', error)
    throw new Error(`Failed to link product to topic: ${error.message}`)
  }
}
