/**
 * Shopify Admin API client (admin-side only).
 *
 * The storefront uses the Storefront API for reads. The admin needs the
 * Admin API for writes — specifically, syncing the artwork's edition
 * cap to the Shopify product's inventory level.
 *
 * Required env:
 *   - SHOPIFY_STORE_DOMAIN          e.g. "artinscale.myshopify.com"
 *   - SHOPIFY_ADMIN_ACCESS_TOKEN    `shpat_...` from a custom app
 *
 * Edition rules:
 *   - `edition_size = null`  → open edition. Inventory tracking OFF.
 *   - `edition_size = N`     → limited edition. Tracking ON, available
 *                              quantity = N - edition_sold.
 *
 * Errors are returned as `{ ok: false, error: '...' }` rather than
 * thrown — callers can decide whether to surface the failure to the
 * operator (worth doing for inventory sync) or swallow (e.g. when the
 * product hasn't been published to Shopify yet).
 */

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = '2024-10';

export interface ShopifyAdminResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface ShopifyVariant {
  id: number;
  inventory_item_id: number;
  inventory_management: 'shopify' | null;
  inventory_policy: 'deny' | 'continue';
}

interface ShopifyImage {
  id: number;
  src: string;
  position: number;
  alt: string | null;
}

interface ShopifyProduct {
  id: number;
  handle: string;
  variants: ShopifyVariant[];
  images?: ShopifyImage[];
}

export interface ProductImageInput {
  /** Public URL Shopify will fetch + host */
  src: string;
  /** Optional alt text for SEO + accessibility */
  alt?: string;
}

function shopifyHeaders(): Record<string, string> | null {
  if (!STORE_DOMAIN || !ADMIN_TOKEN) return null;
  return {
    'X-Shopify-Access-Token': ADMIN_TOKEN,
    'Content-Type': 'application/json',
  };
}

async function shopifyFetch<T>(path: string, init: RequestInit = {}): Promise<ShopifyAdminResult<T>> {
  const headers = shopifyHeaders();
  if (!headers) {
    return {
      ok: false,
      error: 'SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN missing in admin env',
    };
  }
  const url = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `Shopify ${res.status}: ${text.slice(0, 500)}`,
    };
  }
  return { ok: true, data: parsed as T };
}

export async function getShopifyProductByHandle(
  handle: string
): Promise<ShopifyAdminResult<ShopifyProduct | null>> {
  // `fields` keeps the response narrow — we only need variants + images
  const result = await shopifyFetch<{ products: ShopifyProduct[] }>(
    `/products.json?handle=${encodeURIComponent(handle)}&limit=1&fields=id,handle,variants,images`
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.data?.products?.[0] ?? null };
}

/**
 * Find the (single) Shopify location id. The Admin API needs a location
 * to set inventory levels. POD stores typically have one Gelato-managed
 * location; we use it.
 */
export async function getPrimaryShopifyLocationId(): Promise<ShopifyAdminResult<number | null>> {
  const result = await shopifyFetch<{ locations: Array<{ id: number; active: boolean }> }>(
    '/locations.json'
  );
  if (!result.ok) return { ok: false, error: result.error };
  const active = (result.data?.locations ?? []).filter((l) => l.active);
  return { ok: true, data: active[0]?.id ?? null };
}

/**
 * Sync a Shopify product's variants to match an artwork's edition state.
 *
 *   edition_size === null  → set inventory_management = null AND
 *                            inventory_policy = 'continue' (open edition)
 *   edition_size === N     → set inventory_management = 'shopify',
 *                            inventory_policy = 'deny',
 *                            available qty = N - edition_sold
 *
 * Idempotent: re-running with the same edition state is a no-op.
 *
 * Returns ok=false with an actionable error if the product can't be
 * found, the location can't be found, or any Shopify call fails.
 */
export async function syncEditionToShopifyInventory(args: {
  shopifyHandle: string;
  editionSize: number | null;
  editionSold: number;
}): Promise<
  ShopifyAdminResult<{
    updated: number;
    mode: 'open' | 'limited';
    warning?: string;
  }>
> {
  const { shopifyHandle, editionSize, editionSold } = args;

  const productRes = await getShopifyProductByHandle(shopifyHandle);
  if (!productRes.ok) return { ok: false, error: productRes.error };
  const product = productRes.data;
  if (!product) return { ok: false, error: `No Shopify product for handle "${shopifyHandle}"` };

  const isOpen = editionSize == null;
  const available = isOpen ? null : Math.max(0, editionSize - editionSold);

  let updated = 0;
  // Toggle each variant's inventory_management + policy
  for (const variant of product.variants) {
    const wantedMgmt = isOpen ? null : 'shopify';
    const wantedPolicy = isOpen ? 'continue' : 'deny';
    if (variant.inventory_management === wantedMgmt && variant.inventory_policy === wantedPolicy) {
      // already aligned
    } else {
      const updateRes = await shopifyFetch(`/variants/${variant.id}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          variant: {
            id: variant.id,
            inventory_management: wantedMgmt,
            inventory_policy: wantedPolicy,
          },
        }),
      });
      if (!updateRes.ok) return { ok: false, error: updateRes.error };
      updated++;
    }
  }

  // For limited editions, set the actual inventory level. Two-track
  // approach because the operator's Shopify token may lack
  // `read_locations`:
  //   1. Try the canonical inventory_levels.set path (needs location_id)
  //   2. Fall back to writing variant.inventory_quantity directly
  //      (deprecated for multi-location but still works for the
  //      single-location Gelato POD pattern, and only needs
  //      `write_products`).
  let inventoryWarning: string | null = null;
  if (!isOpen && available != null) {
    const locRes = await getPrimaryShopifyLocationId();
    if (locRes.ok && locRes.data) {
      const locationId = locRes.data;
      for (const variant of product.variants) {
        const setRes = await shopifyFetch('/inventory_levels/set.json', {
          method: 'POST',
          body: JSON.stringify({
            location_id: locationId,
            inventory_item_id: variant.inventory_item_id,
            available,
          }),
        });
        if (!setRes.ok) return { ok: false, error: setRes.error };
      }
    } else {
      // Fallback: legacy variant.inventory_quantity path. Works for
      // single-location stores; surfaces a soft warning so the
      // operator can grant `read_locations` if they ever go
      // multi-location.
      inventoryWarning = `read_locations scope unavailable; used legacy variant.inventory_quantity fallback. Grant read_locations on the Shopify Custom App for multi-location safety.`;
      for (const variant of product.variants) {
        const setRes = await shopifyFetch(`/variants/${variant.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({
            variant: { id: variant.id, inventory_quantity: available },
          }),
        });
        if (!setRes.ok) return { ok: false, error: setRes.error };
      }
    }
  }

  return {
    ok: true,
    data: {
      updated,
      mode: isOpen ? 'open' : 'limited',
      ...(inventoryWarning ? { warning: inventoryWarning } : {}),
    },
  };
}

/**
 * Replace a Shopify product's images with our mockup set.
 *
 * Designed for the per-artwork 6-image bundle our composer produces
 * (original, 3 details, framed, in-room). The order of `imageUrls`
 * determines the gallery order on the storefront — first image is the
 * "primary" / cover.
 *
 * Strategy:
 *   1. DELETE every existing image on the Shopify product (clears any
 *      Gelato-generated previews from the auto-publish step)
 *   2. POST each new image in order
 *
 * We intentionally don't use the PUT-with-images-array atomic update
 * because Shopify treats that as "set state" but is finicky about
 * mixing existing + new images. The delete-then-add path is more
 * predictable and idempotent: re-running with the same set produces
 * the same gallery.
 */
export async function replaceShopifyProductImages(args: {
  shopifyHandle: string;
  images: ProductImageInput[];
}): Promise<ShopifyAdminResult<{ uploaded: number; deleted: number }>> {
  const productRes = await getShopifyProductByHandle(args.shopifyHandle);
  if (!productRes.ok) return { ok: false, error: productRes.error };
  const product = productRes.data;
  if (!product) {
    return { ok: false, error: `No Shopify product for handle "${args.shopifyHandle}"` };
  }

  // 1. Delete existing images
  let deleted = 0;
  for (const img of product.images ?? []) {
    const r = await shopifyFetch(`/products/${product.id}/images/${img.id}.json`, {
      method: 'DELETE',
    });
    if (!r.ok) return { ok: false, error: r.error };
    deleted++;
  }

  // 2. Upload new images in order
  let uploaded = 0;
  for (let i = 0; i < args.images.length; i++) {
    const img = args.images[i];
    const r = await shopifyFetch(`/products/${product.id}/images.json`, {
      method: 'POST',
      body: JSON.stringify({
        image: {
          src: img.src,
          alt: img.alt ?? '',
          position: i + 1,
        },
      }),
    });
    if (!r.ok) return { ok: false, error: r.error };
    uploaded++;
  }

  return { ok: true, data: { uploaded, deleted } };
}

/**
 * Top-level Shopify product fields the listing-sync owns.
 *
 * `tags` is a plain string[] — internally Shopify stores it as a
 * comma-joined string but the JSON API accepts both forms. We send the
 * comma-joined form for compatibility.
 *
 * `bodyHtml` is the Shopify product description (the rich-text block
 * shown on the product page). Pushed verbatim — caller is responsible
 * for already-escaped HTML, typically via `buildProductCopy()`.
 */
export interface ShopifyProductCoreFields {
  vendor?: string;
  productType?: string;
  status?: 'active' | 'draft' | 'archived';
  tags?: string[];
  bodyHtml?: string;
}

/**
 * Update the high-level Shopify product fields we manage from admin DB.
 * Skips fields that aren't passed.
 */
export async function updateShopifyProductCore(args: {
  shopifyHandle: string;
  fields: ShopifyProductCoreFields;
}): Promise<ShopifyAdminResult<{ updated: string[] }>> {
  const productRes = await getShopifyProductByHandle(args.shopifyHandle);
  if (!productRes.ok) return { ok: false, error: productRes.error };
  const product = productRes.data;
  if (!product) {
    return {
      ok: false,
      error: `No Shopify product for handle "${args.shopifyHandle}"`,
    };
  }

  const body: Record<string, unknown> = { id: product.id };
  const updated: string[] = [];
  if (args.fields.vendor != null) {
    body.vendor = args.fields.vendor;
    updated.push('vendor');
  }
  if (args.fields.productType != null) {
    body.product_type = args.fields.productType;
    updated.push('product_type');
  }
  if (args.fields.status != null) {
    body.status = args.fields.status;
    updated.push('status');
  }
  if (args.fields.tags != null) {
    body.tags = args.fields.tags.join(', ');
    updated.push('tags');
  }
  if (args.fields.bodyHtml != null) {
    body.body_html = args.fields.bodyHtml;
    updated.push('body_html');
  }
  if (updated.length === 0) {
    return { ok: true, data: { updated: [] } };
  }

  const res = await shopifyFetch(`/products/${product.id}.json`, {
    method: 'PUT',
    body: JSON.stringify({ product: body }),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: { updated } };
}

/**
 * Update a Shopify variant's price (and optionally compare_at_price).
 *
 * Shopify stores price as a string with two decimals; we accept a
 * number and format it. Currency is implicit — set on the Shopify shop,
 * not per-variant.
 */
export async function updateShopifyVariantPrice(args: {
  variantId: number | string;
  price: number;
  compareAtPrice?: number | null;
}): Promise<ShopifyAdminResult<{ price: string }>> {
  const variantBody: Record<string, unknown> = {
    id: args.variantId,
    price: args.price.toFixed(2),
  };
  if (args.compareAtPrice !== undefined) {
    variantBody.compare_at_price =
      args.compareAtPrice == null ? null : args.compareAtPrice.toFixed(2);
  }
  const res = await shopifyFetch<{ variant: { price: string } }>(
    `/variants/${args.variantId}.json`,
    {
      method: 'PUT',
      body: JSON.stringify({ variant: variantBody }),
    }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: { price: res.data?.variant.price ?? '' } };
}

/**
 * Update prices on every variant of a Shopify product. Convenience
 * wrapper for the single-variant museum-poster case where all variants
 * share the same retail price.
 */
export async function updateShopifyProductPrice(args: {
  shopifyHandle: string;
  price: number;
  compareAtPrice?: number | null;
}): Promise<ShopifyAdminResult<{ updatedVariantIds: number[] }>> {
  const productRes = await getShopifyProductByHandle(args.shopifyHandle);
  if (!productRes.ok) return { ok: false, error: productRes.error };
  const product = productRes.data;
  if (!product) {
    return {
      ok: false,
      error: `No Shopify product for handle "${args.shopifyHandle}"`,
    };
  }
  const updatedVariantIds: number[] = [];
  for (const variant of product.variants) {
    const r = await updateShopifyVariantPrice({
      variantId: variant.id,
      price: args.price,
      compareAtPrice: args.compareAtPrice,
    });
    if (!r.ok) return { ok: false, error: r.error };
    updatedVariantIds.push(variant.id);
  }
  return { ok: true, data: { updatedVariantIds } };
}

/**
 * Upsert a single Shopify product metafield.
 *
 * The two SEO metafield slots Shopify exposes in the storefront editor
 * are `global.title_tag` and `global.description_tag`. Open Graph tags
 * are commonly stored under the `seo` namespace (`seo.og_title`, etc.)
 * but storefront themes vary — adjust namespaces to match the theme
 * you've published. Single-line type for SEO title; multi_line for
 * description.
 */
export async function setShopifyProductMetafield(args: {
  productId: number | string;
  namespace: string;
  key: string;
  value: string;
  type?: 'single_line_text_field' | 'multi_line_text_field';
}): Promise<ShopifyAdminResult<{ id: number }>> {
  const res = await shopifyFetch<{ metafield: { id: number } }>(
    `/products/${args.productId}/metafields.json`,
    {
      method: 'POST',
      body: JSON.stringify({
        metafield: {
          namespace: args.namespace,
          key: args.key,
          value: args.value,
          type: args.type ?? 'single_line_text_field',
        },
      }),
    }
  );
  if (!res.ok) {
    // Shopify rejects the POST when the metafield already exists.
    // Fall back to a PUT against the existing one if that's the case.
    if (res.error?.includes('422')) {
      const existingRes = await shopifyFetch<{
        metafields: Array<{
          id: number;
          namespace: string;
          key: string;
        }>;
      }>(
        `/products/${args.productId}/metafields.json?namespace=${encodeURIComponent(
          args.namespace
        )}&key=${encodeURIComponent(args.key)}`
      );
      if (!existingRes.ok) return { ok: false, error: existingRes.error };
      const existing = existingRes.data?.metafields?.find(
        (m) => m.namespace === args.namespace && m.key === args.key
      );
      if (existing) {
        const putRes = await shopifyFetch<{ metafield: { id: number } }>(
          `/metafields/${existing.id}.json`,
          {
            method: 'PUT',
            body: JSON.stringify({
              metafield: {
                id: existing.id,
                value: args.value,
                type: args.type ?? 'single_line_text_field',
              },
            }),
          }
        );
        if (!putRes.ok) return { ok: false, error: putRes.error };
        return { ok: true, data: { id: putRes.data?.metafield.id ?? existing.id } };
      }
    }
    return { ok: false, error: res.error };
  }
  return { ok: true, data: { id: res.data?.metafield.id ?? 0 } };
}

/**
 * Find or create a custom collection by title, then add the product to
 * it via /collects.json. Idempotent — a duplicate collect call returns
 * 422 which we treat as success.
 *
 * We use **custom** collections (manual product list) rather than smart
 * collections (rule-based) because the canonical assignment lives in
 * the admin DB; pushing a stable list keeps the Shopify side
 * predictable and survives storefront theme changes.
 *
 * `bodyHtml`: applied at create time only. We don't update existing
 * collections — that protects operator edits made directly in the
 * Shopify dashboard. To force an update, delete the collection in
 * Shopify and re-run; the next sync will recreate it with the
 * provided description.
 */
export async function assignProductToCollectionByTitle(args: {
  productId: number | string;
  collectionTitle: string;
  bodyHtml?: string;
}): Promise<
  ShopifyAdminResult<{ collectionId: number; created: boolean; alreadyAssigned: boolean }>
> {
  // 1. Look up the collection by title
  const findRes = await shopifyFetch<{
    custom_collections: Array<{ id: number; title: string; handle: string }>;
  }>(
    `/custom_collections.json?title=${encodeURIComponent(args.collectionTitle)}&limit=5`
  );
  if (!findRes.ok) return { ok: false, error: findRes.error };
  let collection = findRes.data?.custom_collections.find(
    (c) => c.title.toLowerCase() === args.collectionTitle.toLowerCase()
  );
  let created = false;

  // 2. Create if missing
  if (!collection) {
    const createBody: Record<string, unknown> = {
      title: args.collectionTitle,
      published: true,
    };
    if (args.bodyHtml) createBody.body_html = args.bodyHtml;
    const createRes = await shopifyFetch<{
      custom_collection: { id: number; title: string; handle: string };
    }>('/custom_collections.json', {
      method: 'POST',
      body: JSON.stringify({ custom_collection: createBody }),
    });
    if (!createRes.ok) return { ok: false, error: createRes.error };
    if (!createRes.data) {
      return { ok: false, error: 'Shopify returned no body for collection create' };
    }
    collection = createRes.data.custom_collection;
    created = true;
  }

  // 3. Add the product (collect)
  const collectRes = await shopifyFetch<{ collect: { id: number } }>('/collects.json', {
    method: 'POST',
    body: JSON.stringify({
      collect: {
        product_id: args.productId,
        collection_id: collection.id,
      },
    }),
  });
  // 422 means the product is already in the collection — treat as success
  if (!collectRes.ok && collectRes.error?.includes('422')) {
    return {
      ok: true,
      data: { collectionId: collection.id, created, alreadyAssigned: true },
    };
  }
  if (!collectRes.ok) return { ok: false, error: collectRes.error };
  return {
    ok: true,
    data: { collectionId: collection.id, created, alreadyAssigned: false },
  };
}

/**
 * Remove a product from a custom collection (by deleting the
 * `collect` join row). Idempotent — returns ok with `removed: false`
 * if the membership doesn't exist.
 */
export async function removeProductFromCollect(args: {
  productId: number | string;
  collectionId: number | string;
}): Promise<ShopifyAdminResult<{ removed: boolean }>> {
  const res = await shopifyFetch<{ collects: Array<{ id: number }> }>(
    `/collects.json?product_id=${args.productId}&collection_id=${args.collectionId}&limit=1`
  );
  if (!res.ok) return { ok: false, error: res.error };
  const collect = res.data?.collects?.[0];
  if (!collect) return { ok: true, data: { removed: false } };
  const del = await shopifyFetch(`/collects/${collect.id}.json`, { method: 'DELETE' });
  if (!del.ok) return { ok: false, error: del.error };
  return { ok: true, data: { removed: true } };
}

/**
 * Reconcile a product's custom-collection memberships.
 *
 * `targetTitles` — collections the product SHOULD be in after sync.
 *   Typically `[topic.title, artist.name, 'Limited Edition']`, with
 *   any of them omitted when not applicable.
 *
 * `managedTitles` — collection titles the sync owns. Anything in this
 *   set but not in `targetTitles` will be **removed** from the
 *   product. Anything outside this set (e.g. a "Bestsellers"
 *   collection the operator added manually in the Shopify dashboard)
 *   is left untouched.
 *
 * The pattern: pass `managedTitles` as the union of all topic titles
 * + all artist names + "Limited Edition" — that way previous topic /
 * artist assignments get cleaned up when the operator changes the
 * artwork's topic_id or artist_id, but operator-managed collections
 * survive.
 *
 * Returns a per-collection result so listing-sync can surface what
 * changed.
 */
export async function reconcileProductCollections(args: {
  productId: number | string;
  targetEntries: Array<{ title: string; bodyHtml?: string }>;
  managedTitles: Set<string>;
}): Promise<
  ShopifyAdminResult<{
    added: string[];
    alreadyAssigned: string[];
    removed: string[];
    untouched: string[];
    errors: Array<{ title: string; message: string }>;
  }>
> {
  const errors: Array<{ title: string; message: string }> = [];

  // 1. Get the product's current memberships
  const collectsRes = await shopifyFetch<{
    collects: Array<{ id: number; collection_id: number; product_id: number }>;
  }>(`/collects.json?product_id=${args.productId}&limit=250`);
  if (!collectsRes.ok) return { ok: false, error: collectsRes.error };

  // 2. Map each collection_id → title via /custom_collections/{id}.json.
  //    Done sequentially (Shopify rate-limits parallel admin calls
  //    aggressively); shouldn't be more than a handful of collections
  //    per product.
  const currentMemberships: Array<{
    collectId: number;
    collectionId: number;
    title: string;
  }> = [];
  for (const c of collectsRes.data?.collects ?? []) {
    const r = await shopifyFetch<{ custom_collection: { id: number; title: string } }>(
      `/custom_collections/${c.collection_id}.json`
    );
    if (!r.ok) {
      // Smart collections (rule-based) live at /smart_collections/.json
      // and won't resolve here — skip with a debug log. We only manage
      // custom collections.
      continue;
    }
    currentMemberships.push({
      collectId: c.id,
      collectionId: c.collection_id,
      title: r.data?.custom_collection.title ?? '',
    });
  }

  // 3. Compute diffs
  const targetTitlesLower = new Set(args.targetEntries.map((e) => e.title.toLowerCase()));
  const managedTitlesLower = new Set(
    [...args.managedTitles].map((t) => t.toLowerCase())
  );

  const added: string[] = [];
  const alreadyAssigned: string[] = [];
  const removed: string[] = [];
  const untouched: string[] = [];

  // 3a. Remove orphans: in managed namespace but not in target
  for (const m of currentMemberships) {
    const titleLower = m.title.toLowerCase();
    if (targetTitlesLower.has(titleLower)) {
      // already correctly assigned
      continue;
    }
    if (managedTitlesLower.has(titleLower)) {
      const r = await removeProductFromCollect({
        productId: args.productId,
        collectionId: m.collectionId,
      });
      if (!r.ok) {
        errors.push({ title: m.title, message: r.error ?? 'unknown' });
      } else if (r.data?.removed) {
        removed.push(m.title);
      }
    } else {
      // Operator-added collection — leave untouched
      untouched.push(m.title);
    }
  }

  // 3b. Add missing targets
  for (const entry of args.targetEntries) {
    const r = await assignProductToCollectionByTitle({
      productId: args.productId,
      collectionTitle: entry.title,
      bodyHtml: entry.bodyHtml,
    });
    if (!r.ok) {
      errors.push({ title: entry.title, message: r.error ?? 'unknown' });
      continue;
    }
    if (r.data?.alreadyAssigned) {
      alreadyAssigned.push(entry.title);
    } else {
      added.push(entry.title);
    }
  }

  return {
    ok: errors.length === 0,
    data: { added, alreadyAssigned, removed, untouched, errors },
  };
}

/**
 * Run a GraphQL admin query/mutation. The REST API doesn't expose
 * publication management cleanly, so a few of our helpers reach for
 * GraphQL — this is the shared transport.
 */
async function shopifyGraphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<ShopifyAdminResult<T>> {
  const headers = shopifyHeaders();
  if (!headers) {
    return {
      ok: false,
      error: 'SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN missing in admin env',
    };
  }
  const url = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const text = await res.text();
  let parsed: { data?: T; errors?: Array<{ message: string }> } | null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    return { ok: false, error: `Shopify GraphQL ${res.status}: ${text.slice(0, 500)}` };
  }
  if (parsed?.errors?.length) {
    return {
      ok: false,
      error: `Shopify GraphQL errors: ${parsed.errors.map((e) => e.message).join('; ')}`,
    };
  }
  return { ok: true, data: parsed?.data as T };
}

interface PublicationsQueryResult {
  publications: {
    edges: Array<{
      node: {
        id: string;
        name: string;
      };
    }>;
  };
}

/**
 * List all sales channels (publications) configured on the store.
 * Cached at module level since channels change rarely and every product
 * publish would otherwise re-fetch on every call.
 */
let _publicationsCache: { ts: number; data: Array<{ id: string; name: string }> } | null = null;
const PUBLICATIONS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function listShopifyPublications(opts: {
  refresh?: boolean;
} = {}): Promise<ShopifyAdminResult<Array<{ id: string; name: string }>>> {
  if (
    !opts.refresh &&
    _publicationsCache &&
    Date.now() - _publicationsCache.ts < PUBLICATIONS_CACHE_TTL_MS
  ) {
    return { ok: true, data: _publicationsCache.data };
  }
  const res = await shopifyGraphql<PublicationsQueryResult>(`
    query {
      publications(first: 50) {
        edges { node { id name } }
      }
    }
  `);
  if (!res.ok) return { ok: false, error: res.error };
  const list = (res.data?.publications.edges ?? []).map((e) => e.node);
  _publicationsCache = { ts: Date.now(), data: list };
  return { ok: true, data: list };
}

interface PublishablePublishResult {
  publishablePublish: {
    publishable: { __typename: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

/**
 * Publish a Shopify product to every available sales channel.
 *
 * Idempotent: re-publishing a product to a channel where it's already
 * published is a no-op (Shopify's `publishablePublish` mutation handles
 * this). Returns the list of channels the product was published to —
 * channels with userErrors land in `errors` and don't fail the whole
 * call.
 *
 * `productGid` must be in the `gid://shopify/Product/<numeric-id>`
 * form. Our admin DB stores it that way (`artwork.shopify_product_id`)
 * after the auto-publisher resolves it.
 *
 * Why all channels: every product should be visible everywhere we have
 * a sales channel configured (Online Store, Google & YouTube, Facebook
 * & Instagram, Artinscale Platform, etc.). The default Shopify
 * behavior on product create publishes only to Online Store, so this
 * fills the rest.
 */
export async function publishProductToAllChannels(args: {
  productGid: string;
}): Promise<
  ShopifyAdminResult<{
    publishedTo: Array<{ id: string; name: string }>;
    errors: Array<{ channel: string; message: string }>;
  }>
> {
  const pubsRes = await listShopifyPublications();
  if (!pubsRes.ok) return { ok: false, error: pubsRes.error };
  const publications = pubsRes.data ?? [];
  if (publications.length === 0) {
    return { ok: true, data: { publishedTo: [], errors: [] } };
  }

  const input = publications.map((p) => ({ publicationId: p.id }));
  const res = await shopifyGraphql<PublishablePublishResult>(
    `
    mutation Publish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { __typename }
        userErrors { field message }
      }
    }
  `,
    { id: args.productGid, input }
  );
  if (!res.ok) return { ok: false, error: res.error };

  const userErrors = res.data?.publishablePublish.userErrors ?? [];
  // Map per-channel errors when the field path includes a channel index.
  const errors = userErrors.map((u) => ({
    channel: u.field?.find((f) => /publication/i.test(f)) ?? 'unknown',
    message: u.message,
  }));
  return {
    ok: true,
    data: { publishedTo: publications, errors },
  };
}
