#!/usr/bin/env node
// Re-sync every retired artwork to Shopify draft.
//
// Retiring an artwork now sets its Shopify product to status='draft'
// (see lib/listing-sync.ts), which pulls it from every sales channel.
// But rows that were flipped to status='retired' *before* that logic
// existed were never unpublished — they may still be `active` and
// purchasable on the storefront despite showing "retired" in the admin.
//
// This backfill closes that gap: it finds all artworks at
// status='retired' and drafts their Shopify products. It does NOT touch
// the DB (the rows are already retired) and does NOT re-run the full
// listing-sync (no listing_meta / collections / channel churn) — a
// retire only needs the product pulled from the storefront.
//
// Idempotent: skips artworks with no shopify_product_id and products
// already at status='draft'.
//
// Usage:
//   pnpm --dir artinscale-admin exec node scripts/resync-retired.mjs --dry-run
//   pnpm --dir artinscale-admin exec node scripts/resync-retired.mjs
//
// Reversal (per piece): flip the artwork back to Listed in the admin and
// save — the sync re-activates and re-publishes it. Or in Shopify Admin →
// Products → set the product back to Active.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

const env = parseEnvFile(resolve(__dirname, '../.env'));
const DRY_RUN = process.argv.includes('--dry-run');

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SHOPIFY_DOMAIN = env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = env.SHOPIFY_ADMIN_ACCESS_TOKEN;

async function shopifyUpdateProductStatus(productId, status) {
  const res = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-10/products/${productId}.json`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ product: { id: parseInt(productId, 10), status } }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function shopifyGetProductStatus(productId) {
  const res = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-10/products/${productId}.json?fields=id,status`,
    { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN } }
  );
  if (!res.ok) return null;
  const body = await res.json();
  return body.product?.status ?? null;
}

function extractShopifyProductId(gid) {
  // gid format: gid://shopify/Product/1234567890
  if (!gid) return null;
  return gid.split('/').pop();
}

async function main() {
  console.log(`Resync-retired ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}`);
  console.log('');

  const { data: retired, error } = await supabase
    .from('artworks')
    .select('id, title, status, shopify_product_id')
    .eq('status', 'retired')
    .order('title');

  if (error) throw error;
  if (!retired?.length) {
    console.log('No retired artworks. Nothing to do.');
    return;
  }

  console.log(`Found ${retired.length} retired artworks:`);
  for (const a of retired) {
    const shopifyId = extractShopifyProductId(a.shopify_product_id);
    console.log(`  · ${a.title}  →  shopify_id=${shopifyId ?? '<none>'}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('[DRY RUN] No changes will be made. Re-run without --dry-run to apply.');
    return;
  }

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (const a of retired) {
    const shopifyId = extractShopifyProductId(a.shopify_product_id);
    if (!shopifyId) {
      console.log(`  ⊘ "${a.title}": no shopify_product_id, skipping`);
      skipped++;
      continue;
    }
    try {
      const currentStatus = await shopifyGetProductStatus(shopifyId);
      if (currentStatus === 'draft') {
        console.log(`  ⊘ "${a.title}": already draft in Shopify, skipping`);
        skipped++;
        continue;
      }
      await shopifyUpdateProductStatus(shopifyId, 'draft');
      console.log(`  ✓ Shopify drafted: ${a.title} (${shopifyId})`);
      ok++;
      // Light pacing to stay well under Shopify's 2/sec limit
      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      console.error(`  ✗ Shopify update failed for "${a.title}": ${err.message}`);
      failed++;
    }
  }
  console.log('');
  console.log(
    `Summary: Shopify ${ok} drafted (${failed} failed, ${skipped} skipped) of ${retired.length} retired`
  );
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
