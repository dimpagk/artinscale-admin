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
 * Cap an image URL to Shopify's hard 20-megapixel product-image limit.
 *
 * Shopify rejects any product image over 20 MP with a 422. Most gallery
 * images (framed/in-room/detail composites) are already web-sized, but
 * the `original` we surface is the print master — for high-resolution
 * pieces (e.g. Emil Varga's 300 DPI code renders, ~28 MP) that busts the
 * limit and, because `replaceShopifyProductImages` deletes existing
 * images before uploading, a single 422 wipes the whole gallery.
 *
 * When the URL is a public Supabase object we rewrite it to the render
 * endpoint with a bounded, aspect-preserving downscale, so Shopify
 * fetches a copy that stays comfortably under 20 MP. Non-Supabase URLs
 * (already web-sized community art) pass through untouched.
 *
 * IMPORTANT: pass both width AND height with `resize=contain`. Supabase's
 * render endpoint does NOT scale height when only `width` is given — it
 * keeps the source height and squashes the width, producing a distorted
 * image (a 4724x5906 master became 2200x5906). `contain` with a square
 * bounding box scales the longest side down to the box while preserving
 * aspect (a 4:5 master → 2400x3000), and never pads.
 */
export function toShopifySafeImageUrl(url: string): string {
  if (typeof url !== 'string' || !url.includes('/storage/v1/object/public/')) return url;
  const rendered = url.replace('/object/public/', '/render/image/public/');
  return `${rendered}${rendered.includes('?') ? '&' : '?'}width=3000&height=3000&resize=contain&quality=90`;
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
    { src: toShopifySafeImageUrl(set.original), alt: `${artworkTitle} - original artwork` },
    { src: set.framed, alt: `${artworkTitle} - framed archival matte print` },
    { src: set.inRoom, alt: `${artworkTitle} - shown in a styled room interior` },
    { src: set.details[0], alt: `${artworkTitle} - close-up detail` },
    { src: set.details[1], alt: `${artworkTitle} - close-up detail (texture)` },
  ];
}
