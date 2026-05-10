/**
 * Listing sync — pushes admin DB state to Shopify (and Gelato).
 *
 * The companion to the listing-generator agent:
 *   - listing-generator writes *creative* fields (SEO/OG copy) to
 *     `artworks.listing_meta` so they can be reviewed and re-used.
 *   - listing-sync reads the canonical fields (price, vendor, tags,
 *     status, collections, etc.) plus the listing_meta and applies
 *     them to Shopify and Gelato.
 *
 * Designed to be:
 *   - Idempotent — re-running with the same inputs is a no-op.
 *   - Step-isolated — a failure in one step doesn't abort the others.
 *     Each step's outcome is recorded so the operator can see what
 *     succeeded and what to retry.
 *   - Cheap — ~5–10 seconds end-to-end for a single-variant museum
 *     poster product (no model calls, no image processing).
 *
 * What it deliberately does NOT do:
 *   - Compose mockup images (long-running; lives in mockup-publisher.ts)
 *   - Create Gelato or Shopify products (lives in pushToGelatoAction)
 *   - Edit storefront-rendered SEO meta tags directly. The storefront
 *     is responsible for reading from Shopify metafields or from our
 *     admin DB; this sync just keeps Shopify up to date.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  buildProductCopy,
} from '@/lib/product-copy';
import { getTemplateConfig } from '@/lib/gelato-templates';
import {
  generateListingMeta,
} from '@/lib/agents/listing-generator';
import {
  getShopifyProductByHandle,
  updateShopifyProductCore,
  updateShopifyProductPrice,
  setShopifyProductMetafield,
  assignProductToCollectionByTitle,
  syncEditionToShopifyInventory,
} from '@/lib/shopify-admin';
import {
  listGelatoProductVariants,
  updateGelatoVariantPrice,
} from '@/lib/gelato';
import { EMPTY_LISTING_META, type ListingMeta } from '@/lib/types';

export interface ListingSyncStep {
  name: string;
  ok: boolean;
  detail?: unknown;
  error?: string;
}

export interface ListingSyncResult {
  artworkId: string;
  shopifyHandle: string | null;
  gelatoProductId: string | null;
  listingMeta: ListingMeta;
  steps: ListingSyncStep[];
  warnings: string[];
}

export interface SyncArtworkOptions {
  /** Force the listing-generator to regenerate even if listing_meta is filled. */
  regenerate?: boolean;
  /** Skip the listing-generator step entirely (for fast price-only syncs). */
  skipAgent?: boolean;
}

/**
 * Sync an artwork's admin DB state to Shopify + Gelato.
 *
 * Order matters:
 *   1. Generate listing_meta if missing (model call) — blocks subsequent
 *      metafield writes.
 *   2. Compute canonical fields from joined artwork+artist+topic.
 *   3. Gelato: push price (per variant). Keeps the Gelato dashboard
 *      accurate; Gelato does NOT propagate this to Shopify.
 *   4. Shopify: product core (vendor / product_type / tags / status).
 *   5. Shopify: variant prices.
 *   6. Shopify: SEO + OG metafields.
 *   7. Shopify: edition→inventory.
 *   8. Shopify: collection memberships.
 *
 * Each step is independent; the function continues past a step's
 * failure and records it in the result.
 */
export async function syncArtworkToShopify(
  artworkId: string,
  options: SyncArtworkOptions = {}
): Promise<ListingSyncResult> {
  const steps: ListingSyncStep[] = [];
  const warnings: string[] = [];

  // ── 1. Load artwork + joins
  const { data: artwork, error: artErr } = await supabaseAdmin
    .from('artworks')
    .select('*')
    .eq('id', artworkId)
    .single();
  if (artErr || !artwork) {
    return {
      artworkId,
      shopifyHandle: null,
      gelatoProductId: null,
      listingMeta: EMPTY_LISTING_META,
      steps: [
        { name: 'load_artwork', ok: false, error: artErr?.message ?? 'not found' },
      ],
      warnings: [],
    };
  }
  steps.push({ name: 'load_artwork', ok: true, detail: { id: artwork.id } });

  if (!artwork.shopify_handle) {
    return {
      artworkId,
      shopifyHandle: null,
      gelatoProductId: artwork.gelato_product_id ?? null,
      listingMeta: artwork.listing_meta ?? EMPTY_LISTING_META,
      steps,
      warnings: [
        'Artwork has no shopify_handle — sync skipped. Push to Gelato first or list manually.',
      ],
    };
  }

  const [{ data: artist }, { data: topic }] = await Promise.all([
    artwork.artist_id
      ? supabaseAdmin
          .from('users')
          .select('id, name, bio')
          .eq('id', artwork.artist_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    artwork.topic_id
      ? supabaseAdmin
          .from('topics')
          .select('id, title, description')
          .eq('id', artwork.topic_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // ── 2. Generate listing_meta if missing
  let listingMeta: ListingMeta = artwork.listing_meta ?? EMPTY_LISTING_META;
  if (!options.skipAgent) {
    try {
      const result = await generateListingMeta({
        artworkId: artwork.id,
        force: options.regenerate === true,
      });
      listingMeta = result.listingMeta;
      steps.push({
        name: 'listing_meta',
        ok: true,
        detail: { skipped: result.skipped, generatedBy: listingMeta.generatedBy },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({ name: 'listing_meta', ok: false, error: msg });
      warnings.push(`listing_meta generation failed: ${msg}`);
    }
  }

  // ── 3. Compute canonical fields
  const productConfig = artwork.product_type
    ? getTemplateConfig(artwork.product_type)
    : null;
  const editionLabel =
    artwork.edition_size != null
      ? `${artwork.edition_sold ?? 0} of ${artwork.edition_size}`
      : 'Open edition';

  // Style: pulled from the artist's primary style pack so the
  // canonical Artwork-details block has a "Style:" line. Best-effort —
  // omitted gracefully when no style pack is configured.
  const style = artist?.id ? await getArtistPrimaryStyle(artist.id) : null;

  const copy = buildProductCopy({
    title: artwork.title,
    artworkSynopsis: artwork.description ?? null,
    inspirationSummary: artwork.inspiration_summary ?? null,
    artistName: artist?.name ?? 'an Artinscale artist',
    artistBio: artist?.bio ?? null,
    topicTitle: topic?.title ?? null,
    topicId: topic?.id ?? null,
    productConfig,
    editionLabel,
    style,
  });

  const vendor = artist?.name?.trim() || 'Artinscale';
  const productType = 'Art Print';
  const status: 'active' | 'draft' = 'active';

  // ── 4. Gelato: push price (so Gelato dashboard isn't stale)
  if (artwork.gelato_product_id && artwork.price != null) {
    try {
      const variants = await listGelatoProductVariants(artwork.gelato_product_id);
      let updated = 0;
      for (const v of variants) {
        if (v.price === artwork.price) continue;
        await updateGelatoVariantPrice({
          productId: artwork.gelato_product_id,
          variantId: v.id,
          price: artwork.price,
          currency: artwork.currency ?? 'EUR',
        });
        updated++;
      }
      steps.push({
        name: 'gelato_price',
        ok: true,
        detail: { variantsTotal: variants.length, variantsUpdated: updated },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({ name: 'gelato_price', ok: false, error: msg });
      warnings.push(`gelato_price: ${msg}`);
    }
  }

  // ── 5. Shopify: product core (vendor, type, status, tags, description)
  const coreRes = await updateShopifyProductCore({
    shopifyHandle: artwork.shopify_handle,
    fields: {
      vendor,
      productType,
      status,
      tags: copy.tags,
      bodyHtml: copy.description,
    },
  });
  steps.push({
    name: 'shopify_core',
    ok: coreRes.ok,
    detail: coreRes.data,
    error: coreRes.error,
  });
  if (!coreRes.ok) warnings.push(`shopify_core: ${coreRes.error}`);

  // ── 6. Shopify: variant prices
  if (artwork.price != null) {
    const priceRes = await updateShopifyProductPrice({
      shopifyHandle: artwork.shopify_handle,
      price: artwork.price,
    });
    steps.push({
      name: 'shopify_price',
      ok: priceRes.ok,
      detail: priceRes.data,
      error: priceRes.error,
    });
    if (!priceRes.ok) warnings.push(`shopify_price: ${priceRes.error}`);
  } else {
    steps.push({
      name: 'shopify_price',
      ok: true,
      detail: { skipped: 'artwork.price is null' },
    });
  }

  // ── 7. Shopify: SEO + OG metafields
  const productLookup = await getShopifyProductByHandle(artwork.shopify_handle);
  if (!productLookup.ok || !productLookup.data) {
    steps.push({
      name: 'shopify_metafields',
      ok: false,
      error:
        productLookup.error ??
        `No Shopify product for handle "${artwork.shopify_handle}"`,
    });
    warnings.push('shopify_metafields: product not found');
  } else {
    const productId = productLookup.data.id;
    const metafieldDefs: Array<{
      slot: string;
      namespace: string;
      key: string;
      value: string | null;
      type: 'single_line_text_field' | 'multi_line_text_field';
    }> = [
      // Shopify global SEO slots — picked up by all themes
      {
        slot: 'seo_title',
        namespace: 'global',
        key: 'title_tag',
        value: listingMeta.seoTitle ?? copy.seoTitle,
        type: 'single_line_text_field',
      },
      {
        slot: 'seo_description',
        namespace: 'global',
        key: 'description_tag',
        value: listingMeta.seoDescription ?? copy.seoDescription,
        type: 'multi_line_text_field',
      },
      // Open Graph metafields. These need a corresponding metafield
      // definition in the storefront theme to be picked up — if your
      // theme doesn't render them, they sit harmlessly in the metafield
      // store until it does.
      {
        slot: 'og_title',
        namespace: 'seo',
        key: 'og_title',
        value: listingMeta.ogTitle,
        type: 'single_line_text_field',
      },
      {
        slot: 'og_description',
        namespace: 'seo',
        key: 'og_description',
        value: listingMeta.ogDescription,
        type: 'multi_line_text_field',
      },
    ];

    const metafieldResults: Record<string, { ok: boolean; error?: string }> = {};
    for (const def of metafieldDefs) {
      if (!def.value) {
        metafieldResults[def.slot] = { ok: true };
        continue;
      }
      const r = await setShopifyProductMetafield({
        productId,
        namespace: def.namespace,
        key: def.key,
        value: def.value,
        type: def.type,
      });
      metafieldResults[def.slot] = { ok: r.ok, error: r.error };
      if (!r.ok) warnings.push(`metafield ${def.slot}: ${r.error}`);
    }
    steps.push({
      name: 'shopify_metafields',
      ok: Object.values(metafieldResults).every((m) => m.ok),
      detail: metafieldResults,
    });
  }

  // ── 8. Shopify: edition→inventory
  const invRes = await syncEditionToShopifyInventory({
    shopifyHandle: artwork.shopify_handle,
    editionSize: artwork.edition_size,
    editionSold: artwork.edition_sold ?? 0,
  });
  steps.push({
    name: 'shopify_inventory',
    ok: invRes.ok,
    detail: invRes.data,
    error: invRes.error,
  });
  if (!invRes.ok) warnings.push(`shopify_inventory: ${invRes.error}`);
  if (invRes.ok && invRes.data?.warning) warnings.push(invRes.data.warning);

  // ── 9. Shopify: collection memberships
  // Drive collections from canonical fields. body_html is applied at
  // create time only — operator edits in Shopify dashboard stay safe
  // for existing collections.
  //   - Topic title (e.g. "Breath") with description from topic
  //   - Artist name (e.g. "Maya Riso") with description from artist bio
  //   - "Limited Edition" — only when edition_size is set, fixed copy
  if (productLookup.ok && productLookup.data) {
    const productId = productLookup.data.id;
    const collectionEntries: Array<{ title: string; bodyHtml?: string }> = [];
    if (topic?.title) {
      collectionEntries.push({
        title: topic.title,
        bodyHtml: buildTopicCollectionBody(topic),
      });
    }
    if (artist?.name) {
      collectionEntries.push({
        title: artist.name,
        bodyHtml: buildArtistCollectionBody(artist),
      });
    }
    if (artwork.edition_size != null) {
      collectionEntries.push({
        title: 'Limited Edition',
        bodyHtml: LIMITED_EDITION_COLLECTION_BODY,
      });
    }

    const collectionResults: Record<
      string,
      { ok: boolean; created?: boolean; alreadyAssigned?: boolean; error?: string }
    > = {};
    for (const entry of collectionEntries) {
      const r = await assignProductToCollectionByTitle({
        productId,
        collectionTitle: entry.title,
        bodyHtml: entry.bodyHtml,
      });
      collectionResults[entry.title] = {
        ok: r.ok,
        created: r.data?.created,
        alreadyAssigned: r.data?.alreadyAssigned,
        error: r.error,
      };
      if (!r.ok) warnings.push(`collection "${entry.title}": ${r.error}`);
    }
    steps.push({
      name: 'shopify_collections',
      ok: Object.values(collectionResults).every((c) => c.ok),
      detail: collectionResults,
    });
  }

  return {
    artworkId,
    shopifyHandle: artwork.shopify_handle,
    gelatoProductId: artwork.gelato_product_id ?? null,
    listingMeta,
    steps,
    warnings,
  };
}

/**
 * Body copy for the auto-created "Limited Edition" collection. Fixed
 * copy across all sites — small enough to be a constant. Operator can
 * edit in the Shopify dashboard afterward.
 */
const LIMITED_EDITION_COLLECTION_BODY =
  '<p>Numbered editions, archival paper, museum-quality matte. Each piece in this collection is produced in a fixed run — once the run sells out, it stays sold out.</p>';

/**
 * Build the `body_html` for an auto-created topic collection.
 * Prefers the topic's `long_description` (the storefront's marketing
 * copy) and falls back to `description`. Plain text is wrapped in a
 * single `<p>` so the storefront renders consistently.
 */
function buildTopicCollectionBody(topic: { description?: string | null; long_description?: string | null } | null): string | undefined {
  if (!topic) return undefined;
  const long = topic.long_description?.trim();
  const short = topic.description?.trim();
  const body = long || short;
  if (!body) return undefined;
  // If body already looks like HTML (has tags), pass through; else wrap.
  return /<\w+/.test(body) ? body : `<p>${escapeCollectionHtml(body)}</p>`;
}

/**
 * Build the `body_html` for an auto-created artist collection.
 * Trims the bio to a single paragraph (cuts at first double-newline)
 * and wraps as HTML. Provides a sensible default that shows what the
 * artist's work is about without operator effort.
 */
function buildArtistCollectionBody(artist: { name?: string | null; bio?: string | null } | null): string | undefined {
  if (!artist?.bio) return undefined;
  const trimmed = artist.bio.trim().split(/\n\s*\n/)[0]?.trim();
  if (!trimmed) return undefined;
  return /<\w+/.test(trimmed) ? trimmed : `<p>${escapeCollectionHtml(trimmed)}</p>`;
}

function escapeCollectionHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolve an artist's primary style descriptor for the Artwork-details
 * "Style:" line. Reads `style_packs` and applies the same derivation
 * rule both pushToGelatoAction (initial create) and the sync use.
 *
 * Returns null when the artist has no primary pack — the caller's
 * `buildProductCopy` then omits the Style line entirely.
 */
export async function getArtistPrimaryStyle(
  artistId: string
): Promise<string | null> {
  const { data: pack } = await supabaseAdmin
    .from('style_packs')
    .select('id, pack')
    .eq('artist_id', artistId)
    .eq('is_primary', true)
    .maybeSingle();
  return deriveStyleDescriptor(pack);
}

/**
 * Best-effort short style descriptor for the Artwork-details
 * "Style:" line, derived from the artist's primary style pack.
 *
 * Lookup order:
 *   1. Explicit `pack.persona.styleDescriptor` (operator-set)
 *   2. Explicit `pack.styleDescriptor` (top-level operator override)
 *   3. Heuristic: take the leading word from `pack.id` (kebab-case)
 *      and append ", illustration" — e.g. `risograph-pulse` →
 *      "Risograph, illustration"
 *   4. null — caller's `buildProductCopy` will omit the line
 *
 * Adding an explicit `styleDescriptor` to the pack JSON is the path
 * forward for operator control without code changes.
 */
function deriveStyleDescriptor(
  pack: { id?: string; pack?: unknown } | null
): string | null {
  if (!pack) return null;
  const inner = (pack.pack ?? null) as
    | { persona?: { styleDescriptor?: unknown }; styleDescriptor?: unknown }
    | null;
  const personaStyle = inner?.persona?.styleDescriptor;
  if (typeof personaStyle === 'string' && personaStyle.trim()) return personaStyle.trim();
  const topStyle = inner?.styleDescriptor;
  if (typeof topStyle === 'string' && topStyle.trim()) return topStyle.trim();
  if (typeof pack.id === 'string' && pack.id) {
    const head = pack.id.split('-')[0];
    if (head) return `${head.charAt(0).toUpperCase()}${head.slice(1)}, illustration`;
  }
  return null;
}
