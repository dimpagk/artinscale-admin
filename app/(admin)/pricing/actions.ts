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
