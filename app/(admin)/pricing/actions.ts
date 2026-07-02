'use server';

/**
 * Classics pricing edit action.
 *
 * On save: (1) upsert the new price into print_size_pricing so the
 * storefront picks it up for future products with no deploy, and (2)
 * PATCH the price on every existing external ("classics") Shopify
 * product variant of that size, so already-listed pieces reprice too.
 *
 * Productionises the one-off variant-PATCH script that was run by hand
 * three times while iterating on pricing.
 */

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';

const API_VERSION = '2024-10';

const rawDomain = process.env.SHOPIFY_STORE_DOMAIN ?? '';
const SHOP_DOMAIN = rawDomain
  ? rawDomain.replace('https://', '').replace('.myshopify.com', '') + '.myshopify.com'
  : '';
const SHOP_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? '';

export interface UpdatePriceResult {
  ok: boolean;
  message: string;
  variantsPatched?: number;
}

export async function updatePriceAction(formData: FormData): Promise<void> {
  const sizeKey = String(formData.get('size_key') ?? '').trim();
  const displayName = String(formData.get('display_name') ?? '').trim();
  const widthCm = Number(formData.get('width_cm'));
  const heightCm = Number(formData.get('height_cm'));
  const price = Number(formData.get('price'));

  if (!sizeKey || !displayName || !Number.isFinite(price) || price <= 0) {
    return; // silently ignore malformed submits; UI validates client-side too
  }

  // 1. Upsert into print_size_pricing. Upsert (not update) so it still
  //    persists if the row was somehow missing; carries the descriptive
  //    columns so a fresh insert is complete.
  const { error: dbError } = await supabaseAdmin
    .from('print_size_pricing')
    .upsert(
      {
        size_key: sizeKey,
        display_name: displayName,
        width_cm: Number.isFinite(widthCm) ? widthCm : 0,
        height_cm: Number.isFinite(heightCm) ? heightCm : 0,
        price_eur: price,
      },
      { onConflict: 'size_key' }
    );

  // If the table doesn't exist yet (migration 032 not applied), the upsert
  // errors — we still try the Shopify patch so at least live products
  // reprice, and surface nothing blocking. Operator sees the banner on the
  // page telling them to run the migration for persistence.
  if (dbError) {
    console.error('[pricing] print_size_pricing upsert failed:', dbError.message);
  }

  // 2. Reprice existing external Shopify variants of this size.
  await patchShopifyVariantsForSize(displayName, price).catch((e) => {
    console.error('[pricing] Shopify variant patch failed:', e);
  });

  revalidatePath('/pricing');
}

/**
 * Find every external ("classics") Shopify product variant whose title
 * matches the size's display name and PUT the new price. External
 * products are single-variant (one size per piece), so this matches the
 * one variant on each product listed at that size.
 */
async function patchShopifyVariantsForSize(displayName: string, price: number): Promise<number> {
  if (!SHOP_DOMAIN || !SHOP_TOKEN) return 0;
  const priceStr = price.toFixed(2);

  const query = `
    { products(first: 100, query: "tag:external") {
        edges { node { variants(first: 5) { edges { node { id title price } } } } }
    } }`;

  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOP_TOKEN },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify product list HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: {
      products?: { edges?: Array<{ node: { variants: { edges: Array<{ node: { id: string; title: string; price: string } }> } } }> };
    };
  };

  const targets: string[] = [];
  for (const p of body.data?.products?.edges ?? []) {
    for (const v of p.node.variants.edges) {
      if (v.node.title === displayName && v.node.price !== priceStr) {
        targets.push(v.node.id.replace('gid://shopify/ProductVariant/', ''));
      }
    }
  }

  let patched = 0;
  for (const variantId of targets) {
    const put = await fetch(
      `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/variants/${variantId}.json`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOP_TOKEN },
        body: JSON.stringify({ variant: { id: Number(variantId), price: priceStr } }),
      }
    );
    if (put.ok) patched++;
    else console.error(`[pricing] variant ${variantId} PUT HTTP ${put.status}`);
  }
  return patched;
}

// ─── Originals (per-piece) pricing ──────────────────────────────────

/**
 * Originals price edit action.
 *
 * Unlike classics (one shared price per size), each original is a unique
 * artworks row with its own price. On save: (1) write artworks.price so
 * the admin + storefront read the new number, and (2) reprice the piece's
 * Shopify variant(s) so the live listing updates. Originals are
 * single-variant, so this normally patches one variant; the loop tolerates
 * multi-variant pieces by repricing them all to the same number.
 *
 * A piece with no shopify_product_id (not yet published) still gets its DB
 * price saved — there's simply no Shopify listing to patch.
 */
export async function updateOriginalPriceAction(formData: FormData): Promise<void> {
  const artworkId = String(formData.get('artwork_id') ?? '').trim();
  const price = Number(formData.get('price'));
  if (!artworkId || !Number.isFinite(price) || price <= 0) return;

  const { error: dbErr } = await supabaseAdmin
    .from('artworks')
    .update({ price })
    .eq('id', artworkId);
  if (dbErr) console.error('[pricing] artwork price update failed:', dbErr.message);

  // Reprice the live Shopify listing if this piece is published.
  const { data: art } = await supabaseAdmin
    .from('artworks')
    .select('shopify_product_id')
    .eq('id', artworkId)
    .maybeSingle();
  const gid = (art?.shopify_product_id as string | null | undefined) ?? null;
  if (gid) {
    // shopify_product_id is stored as a GID ("gid://shopify/Product/123").
    // Strip to the numeric id the REST endpoints expect.
    const numericId = gid.replace(/\D/g, '');
    if (numericId) {
      await repriceOriginalShopifyVariants(numericId, price).catch((e) =>
        console.error('[pricing] original Shopify reprice failed:', e)
      );
    }
  }

  revalidatePath('/pricing');
}

/**
 * PUT the new price onto every variant of one originals Shopify product.
 * Fetches the product's variants, then patches each whose price differs.
 * Leaves compare_at_price untouched (no active sale is assumed in the
 * per-piece editor). Returns how many variants were repriced.
 */
async function repriceOriginalShopifyVariants(
  numericProductId: string,
  price: number
): Promise<number> {
  if (!SHOP_DOMAIN || !SHOP_TOKEN) return 0;
  const priceStr = price.toFixed(2);

  const getRes = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products/${numericProductId}.json?fields=id,variants`,
    { headers: { 'X-Shopify-Access-Token': SHOP_TOKEN } }
  );
  if (!getRes.ok) throw new Error(`Shopify product GET HTTP ${getRes.status}`);
  const body = (await getRes.json()) as {
    product?: { variants?: Array<{ id: number; price: string }> };
  };
  const variants = body.product?.variants ?? [];

  let patched = 0;
  for (const v of variants) {
    if (v.price === priceStr) continue;
    const put = await fetch(
      `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/variants/${v.id}.json`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOP_TOKEN },
        body: JSON.stringify({ variant: { id: v.id, price: priceStr } }),
      }
    );
    if (put.ok) patched++;
    else console.error(`[pricing] original variant ${v.id} PUT HTTP ${put.status}`);
  }
  return patched;
}

// ─── Discount campaigns ─────────────────────────────────────────────

/** Create a draft classics campaign. Apply it separately to go live. */
export async function createCampaignAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const discount = Number(formData.get('discount_percent'));
  if (!name || !Number.isFinite(discount) || discount <= 0 || discount >= 100) return;

  const { error } = await supabaseAdmin.from('pricing_campaigns').insert({
    name,
    scope: 'classics',
    discount_percent: discount,
    status: 'draft',
  });
  if (error) console.error('[pricing] createCampaign failed:', error.message);
  revalidatePath('/pricing');
}

/**
 * Apply a draft campaign: mark it active (the DB's one-active partial
 * unique index rejects a second active campaign — that's the guard), then
 * discount every classics Shopify variant, stashing the pre-sale price in
 * compare_at_price for the strikethrough. Variants already on sale are
 * skipped so re-applies don't compound.
 */
export async function applyCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get('campaign_id') ?? '').trim();
  if (!id) return;

  const { data: camp } = await supabaseAdmin
    .from('pricing_campaigns')
    .select('id, status, discount_percent')
    .eq('id', id)
    .maybeSingle();
  if (!camp || camp.status !== 'draft') return;

  // Activate first — fails on the unique index if another campaign is
  // already active, so we never discount while one sale is live.
  const { error: actErr } = await supabaseAdmin
    .from('pricing_campaigns')
    .update({ status: 'active', applied_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft');
  if (actErr) {
    console.error('[pricing] applyCampaign activate blocked:', actErr.message);
    revalidatePath('/pricing');
    return;
  }

  const discount = Number(camp.discount_percent);
  const variants = await listExternalVariants().catch(() => []);
  for (const v of variants) {
    if (v.compareAtPrice != null) continue; // already on sale
    const base = Number(v.price);
    if (!Number.isFinite(base) || base <= 0) continue;
    const newPrice = (base * (1 - discount / 100)).toFixed(2);
    await putVariantPricing(v.id, newPrice, base.toFixed(2)).catch((e) =>
      console.error(`[pricing] apply variant ${v.id} failed:`, e)
    );
  }
  revalidatePath('/pricing');
}

/**
 * Revert an active campaign: restore every on-sale classics variant's
 * price from compare_at_price (and clear it), then mark the campaign
 * ended. Prices are restored first so the customer-facing state is
 * corrected even if the status write hiccups.
 */
export async function revertCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get('campaign_id') ?? '').trim();
  if (!id) return;

  const { data: camp } = await supabaseAdmin
    .from('pricing_campaigns')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!camp || camp.status !== 'active') return;

  const variants = await listExternalVariants().catch(() => []);
  for (const v of variants) {
    if (v.compareAtPrice == null) continue; // not on sale
    await putVariantPricing(v.id, v.compareAtPrice, null).catch((e) =>
      console.error(`[pricing] revert variant ${v.id} failed:`, e)
    );
  }

  const { error } = await supabaseAdmin
    .from('pricing_campaigns')
    .update({ status: 'ended', reverted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[pricing] revertCampaign status write failed:', error.message);
  revalidatePath('/pricing');
}

interface ExtVariant {
  id: string;
  price: string;
  compareAtPrice: string | null;
}

/** Every classics (tag:external) Shopify variant with price + sale price. */
async function listExternalVariants(): Promise<ExtVariant[]> {
  if (!SHOP_DOMAIN || !SHOP_TOKEN) return [];
  const query = `
    { products(first: 100, query: "tag:external") {
        edges { node { variants(first: 5) { edges { node { id price compareAtPrice } } } } }
    } }`;
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOP_TOKEN },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify product list HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: {
      products?: {
        edges?: Array<{
          node: { variants: { edges: Array<{ node: { id: string; price: string; compareAtPrice: string | null } }> } };
        }>;
      };
    };
  };
  const out: ExtVariant[] = [];
  for (const p of body.data?.products?.edges ?? []) {
    for (const v of p.node.variants.edges) {
      out.push({
        id: v.node.id.replace('gid://shopify/ProductVariant/', ''),
        price: v.node.price,
        compareAtPrice: v.node.compareAtPrice,
      });
    }
  }
  return out;
}

/** PUT a variant's price and compare_at_price (null clears the sale). */
async function putVariantPricing(
  variantId: string,
  price: string,
  compareAtPrice: string | null
): Promise<void> {
  const res = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/variants/${variantId}.json`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOP_TOKEN },
      body: JSON.stringify({
        variant: { id: Number(variantId), price, compare_at_price: compareAtPrice },
      }),
    }
  );
  if (!res.ok) throw new Error(`variant ${variantId} PUT HTTP ${res.status}`);
}
