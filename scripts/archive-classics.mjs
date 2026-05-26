#!/usr/bin/env node
// Archive the legacy Classics collection.
//
// Identifies the 16 Classics by artist email pattern (@artinscale.classic),
// retires them in the artworks table, and sets the matching Shopify
// products to status='draft' so they're no longer visible in the storefront.
//
// Reasoning: the on-demand external_prints pipeline replaces the Classics
// as the source of public-domain art on the storefront. The 16 hard-coded
// Classic pieces become redundant inventory — retire rather than delete so
// existing order history references remain intact.
//
// Idempotent: re-running skips artworks already at status='retired' and
// Shopify products already at status='draft'.
//
// Usage:
//   pnpm --dir artinscale-admin exec node scripts/archive-classics.mjs --dry-run
//   pnpm --dir artinscale-admin exec node scripts/archive-classics.mjs
//
// Reversal:
//   To restore: UPDATE artworks SET status='listed' WHERE artist_id IN
//   (SELECT id FROM users WHERE email LIKE '%@artinscale.classic');
//   Then in Shopify Admin → Products → bulk select Classics → set Active.

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
  console.log(`Archive-classics ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}`);
  console.log('');

  const { data: artists, error: artistsError } = await supabase
    .from('users')
    .select('id, name, email')
    .like('email', '%@artinscale.classic');

  if (artistsError) throw artistsError;
  if (!artists?.length) {
    console.log('No classic artists found. Nothing to archive.');
    return;
  }
  console.log(`Found ${artists.length} classic artists:`);
  for (const a of artists) console.log(`  · ${a.name}`);
  console.log('');

  const artistIds = artists.map((a) => a.id);
  const { data: classics, error: artworksError } = await supabase
    .from('artworks')
    .select('id, title, status, shopify_product_id')
    .in('artist_id', artistIds)
    .order('title');

  if (artworksError) throw artworksError;
  if (!classics?.length) {
    console.log('No classic artworks. Nothing to do.');
    return;
  }
  console.log(`Found ${classics.length} classic artworks:`);
  for (const c of classics) {
    const shopifyId = extractShopifyProductId(c.shopify_product_id);
    console.log(`  [${c.status}] ${c.title}  →  shopify_id=${shopifyId ?? '<none>'}`);
  }
  console.log('');

  const toRetire = classics.filter((c) => c.status !== 'retired');
  console.log(
    `Plan: retire ${toRetire.length} artworks (skip ${classics.length - toRetire.length} already retired)`
  );
  console.log('');

  if (DRY_RUN) {
    console.log('[DRY RUN] No changes will be made. Re-run without --dry-run to apply.');
    return;
  }

  // 1. Retire in DB
  let dbOk = 0;
  let dbFail = 0;
  for (const c of toRetire) {
    const { error } = await supabase
      .from('artworks')
      .update({ status: 'retired' })
      .eq('id', c.id);
    if (error) {
      console.error(`  ✗ DB update failed for "${c.title}": ${error.message}`);
      dbFail++;
    } else {
      console.log(`  ✓ DB retired: ${c.title}`);
      dbOk++;
    }
  }
  console.log('');

  // 2. Set Shopify products to draft
  let shopifyOk = 0;
  let shopifyFail = 0;
  let shopifySkipped = 0;
  for (const c of toRetire) {
    const shopifyId = extractShopifyProductId(c.shopify_product_id);
    if (!shopifyId) {
      console.log(`  ⊘ "${c.title}": no shopify_product_id, skipping Shopify update`);
      shopifySkipped++;
      continue;
    }
    try {
      const currentStatus = await shopifyGetProductStatus(shopifyId);
      if (currentStatus === 'draft') {
        console.log(`  ⊘ "${c.title}": already draft in Shopify, skipping`);
        shopifySkipped++;
        continue;
      }
      await shopifyUpdateProductStatus(shopifyId, 'draft');
      console.log(`  ✓ Shopify drafted: ${c.title} (${shopifyId})`);
      shopifyOk++;
      // Light pacing to stay well under Shopify's 2/sec limit
      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      console.error(`  ✗ Shopify update failed for "${c.title}": ${err.message}`);
      shopifyFail++;
    }
  }
  console.log('');
  console.log(
    `Summary: DB ${dbOk} retired (${dbFail} failed), Shopify ${shopifyOk} drafted (${shopifyFail} failed, ${shopifySkipped} skipped)`
  );
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
