import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Reviewable paid-ad copy (table `ad_creatives`, migration 046). One row
 * per (piece, format, campaign). Read-only review artifact: approving a
 * creative here just marks the copy ready to paste into Meta Ads Manager;
 * nothing auto-publishes.
 */

export type AdCreativeStatus = 'draft' | 'approved' | 'rejected';
export type AdCreativeFormat = 'in_room' | 'flat' | 'video';

export interface AdCreative {
  id: string;
  artwork_id: string;
  campaign: string;
  format: AdCreativeFormat;
  headline: string;
  primary_text: string;
  status: AdCreativeStatus;
  ai_disclosure: boolean;
  notes: string | null;
  updated_at: string;
}

/** One image in the canonical ad-carousel order. */
export interface CarouselImage {
  label: string;
  url: string;
}

/** A piece with its creatives, plus the fields the review UI renders. */
export interface AdCreativeGroup {
  artworkId: string;
  title: string;
  price: number | null;
  currency: string | null;
  shopifyHandle: string | null;
  /**
   * The mockup set in the fixed ad-carousel order:
   * framed, room, zoom 1, zoom 2, original (plain last). Missing images
   * are skipped, so a piece without a full set still renders in order.
   */
  images: CarouselImage[];
  creatives: AdCreative[];
}

interface ArtworkJoin {
  id: string;
  title: string;
  price: number | null;
  currency: string | null;
  shopify_handle: string | null;
  mockup_urls: Record<string, unknown> | null;
}

/**
 * The mockup set in the fixed ad-carousel order, framed first and the
 * plain original last:
 *   1. Framed   2. Room   3. Zoom 1   4. Zoom 2   5. Original
 * Any image that isn't present is simply skipped (order preserved).
 */
function carouselImages(mockups: Record<string, unknown> | null): CarouselImage[] {
  if (!mockups) return [];
  const out: CarouselImage[] = [];
  const push = (label: string, value: unknown) => {
    if (typeof value === 'string' && value) out.push({ label, url: value });
  };
  const details = Array.isArray(mockups.details) ? mockups.details : [];
  push('Framed', mockups.framed);
  push('Room', mockups.inRoom);
  push('Zoom 1', details[0]);
  push('Zoom 2', details[1]);
  push('Original', mockups.original);
  return out;
}

/**
 * All creatives for a campaign, grouped by piece and ordered by piece
 * price (headline pieces first). Defaults to the marketing-test campaign.
 */
export async function getAdCreativeGroups(
  campaign = 'test-2026-07'
): Promise<AdCreativeGroup[]> {
  const { data, error } = await supabaseAdmin
    .from('ad_creatives')
    .select(
      'id, artwork_id, campaign, format, headline, primary_text, status, ai_disclosure, notes, updated_at, artworks!inner(id, title, price, currency, shopify_handle, mockup_urls)'
    )
    .eq('campaign', campaign)
    .order('format', { ascending: true });

  if (error || !data) return [];

  const byPiece = new Map<string, AdCreativeGroup>();
  for (const row of data as unknown as Array<AdCreative & { artworks: ArtworkJoin }>) {
    const art = row.artworks;
    let group = byPiece.get(art.id);
    if (!group) {
      group = {
        artworkId: art.id,
        title: art.title,
        price: art.price,
        currency: art.currency,
        shopifyHandle: art.shopify_handle,
        images: carouselImages(art.mockup_urls),
        creatives: [],
      };
      byPiece.set(art.id, group);
    }
    group.creatives.push({
      id: row.id,
      artwork_id: row.artwork_id,
      campaign: row.campaign,
      format: row.format,
      headline: row.headline,
      primary_text: row.primary_text,
      status: row.status,
      ai_disclosure: row.ai_disclosure,
      notes: row.notes,
      updated_at: row.updated_at,
    });
  }

  return Array.from(byPiece.values()).sort(
    (a, b) => (b.price ?? 0) - (a.price ?? 0)
  );
}

export interface CampaignCopyStats {
  total: number;
  approved: number;
  draft: number;
  rejected: number;
}

export function summarize(groups: AdCreativeGroup[]): CampaignCopyStats {
  const all = groups.flatMap((g) => g.creatives);
  return {
    total: all.length,
    approved: all.filter((c) => c.status === 'approved').length,
    draft: all.filter((c) => c.status === 'draft').length,
    rejected: all.filter((c) => c.status === 'rejected').length,
  };
}
