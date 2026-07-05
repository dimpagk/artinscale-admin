/**
 * Bridges the per-artwork mockup composer to Shopify product images.
 *
 *   composeArtworkMockups → MockupSet { original, details[2], framed, inRoom }
 *   pushArtworkMockupsToShopify → upload that set in display order
 *
 * Display order chosen for fine-art conversion (in this priority):
 *   1. Original artwork       — the art itself, full bleed (cover)
 *   2. Framed close-up        — "this is a print", studio-clean
 *   3. In-room shot           — lifestyle context, helps with sizing
 *   4-5. Two focal details    — texture / craftsmanship close-ups
 *
 * Idempotent: re-running with the same MockupSet produces the same
 * gallery. Calls `replaceShopifyProductImages` which deletes existing
 * images first.
 */

import { composeArtworkMockups, type MockupSet } from './mockup-composer';
import { replaceShopifyProductImages } from './shopify-admin';
import { supabaseAdmin } from './supabase/admin';

export interface PushMockupsResult {
  artworkId: string;
  shopifyHandle: string;
  uploaded: number;
  deleted: number;
}

export async function pushArtworkMockupsToShopify(
  artworkId: string
): Promise<{ ok: true; data: PushMockupsResult } | { ok: false; error: string }> {
  // Load artwork
  const { data: artwork, error: artErr } = await supabaseAdmin
    .from('artworks')
    .select('id, title, image_url, shopify_handle, product_type')
    .eq('id', artworkId)
    .single();
  if (artErr || !artwork) {
    return { ok: false, error: artErr?.message ?? 'Artwork not found' };
  }
  if (!artwork.shopify_handle) {
    return { ok: false, error: 'Artwork has no shopify_handle — list it first' };
  }
  if (!artwork.image_url) {
    return { ok: false, error: 'Artwork has no image_url' };
  }
  if (!artwork.product_type) {
    return { ok: false, error: 'Artwork has no product_type' };
  }

  // Compose (or reuse) the mockup set. Composer is idempotent — skips
  // anything already in storage.
  const composed = await composeArtworkMockups({
    artworkId: artwork.id,
    sourceImageUrl: artwork.image_url,
    productType: artwork.product_type,
  });
  // Catastrophic only when every composite fell back to the raw source
  // image — then the "gallery" would just be the original five times over.
  const set = composed.imageUrls;
  const nothingProduced =
    set.framed === artwork.image_url &&
    set.inRoom === artwork.image_url &&
    set.details.every((d) => d === artwork.image_url);
  if (nothingProduced && composed.errors.length > 0) {
    return {
      ok: false,
      error: `Mockup compose failed completely: ${composed.errors.join('; ')}`,
    };
  }

  const orderedImages = mockupSetToShopifyOrder(composed.imageUrls, artwork.title);

  const upload = await replaceShopifyProductImages({
    shopifyHandle: artwork.shopify_handle,
    images: orderedImages,
  });
  if (!upload.ok) return { ok: false, error: upload.error ?? 'Upload failed' };

  return {
    ok: true,
    data: {
      artworkId: artwork.id,
      shopifyHandle: artwork.shopify_handle,
      uploaded: upload.data!.uploaded,
      deleted: upload.data!.deleted,
    },
  };
}

/**
 * Convert the composer's MockupSet to the Shopify image array in
 * display order, with descriptive alt text for SEO + accessibility.
 * Exported so the compose-mockups route shares the exact ordering.
 */
export function mockupSetToShopifyOrder(
  set: MockupSet,
  artworkTitle: string
): Array<{ src: string; alt: string }> {
  return [
    { src: set.original, alt: `${artworkTitle} - original artwork` },
    { src: set.framed, alt: `${artworkTitle} - framed archival matte print` },
    { src: set.inRoom, alt: `${artworkTitle} - shown in a styled room interior` },
    { src: set.details[0], alt: `${artworkTitle} - close-up detail` },
    { src: set.details[1], alt: `${artworkTitle} - close-up detail (texture)` },
  ];
}
