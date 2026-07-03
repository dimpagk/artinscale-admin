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

/** A piece with its creatives, plus the fields the review UI renders. */
export interface AdCreativeGroup {
  artworkId: string;
  title: string;
  price: number | null;
  currency: string | null;
  shopifyHandle: string | null;
  /** Best available preview image: the in-room mockup, else the original. */
  previewImage: string | null;
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

function previewFrom(mockups: Record<string, unknown> | null): string | null {
  if (!mockups) return null;
  const inRoom = mockups.inRoom;
  if (typeof inRoom === 'string') return inRoom;
  const original = mockups.original;
  if (typeof original === 'string') return original;
  const framed = mockups.framed;
  if (typeof framed === 'string') return framed;
  return null;
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
        previewImage: previewFrom(art.mockup_urls),
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
