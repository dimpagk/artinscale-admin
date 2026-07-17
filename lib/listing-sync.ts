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
  formatDimensions,
  formatMedium,
  formatOrientation,
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
  setShopifyVariantMetafield,
  setShopifyProductCategory,
  reconcileProductCollections,
  syncEditionToShopifyInventory,
  publishProductToAllChannels,
} from '@/lib/shopify-admin';
import {
  listGelatoProductVariants,
  updateGelatoVariantPrice,
} from '@/lib/gelato';
import { EMPTY_LISTING_META, type ListingMeta } from '@/lib/types';

/**
 * Community artworks default to a 50x70 print. When an artwork has no
 * explicit `product_type` (older community pieces never had a size
 * assigned), we still surface a dimension on the storefront by falling
 * back to this size for the `custom.dimensions` metafield. Scoped to
 * the storefront metafields (dimensions, medium, orientation) only; it
 * does NOT change the Gelato order, the size tags, or the description
 * body.
 */
const DEFAULT_COMMUNITY_PRODUCT_TYPE = 'museum-poster-50x70';

/**
 * Shopify standard-taxonomy category for every Artinscale product:
 * Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork >
 * Prints. Stable public id from github.com/Shopify/product-taxonomy,
 * identical across stores, so it's safe to hardcode. Drives tax rates
 * and the Google/Meta feed category mapping.
 */
const PRINTS_TAXONOMY_CATEGORY_GID = 'gid://shopify/TaxonomyCategory/hg-3-4-2-2';

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
 *   1. Gelato: push price (per variant). Runs before the shopify_handle
 *      guard so pushed-but-not-yet-listed pieces still get their Gelato
 *      price kept fresh. Keeps the Gelato dashboard accurate; Gelato does
 *      NOT propagate this to Shopify.
 *   2. Generate listing_meta if missing (model call) — blocks subsequent
 *      metafield writes.
 *   3. Compute canonical fields from joined artwork+artist+topic.
 *   4. Shopify: product core (vendor / product_type / tags / status).
 *   5. Shopify: variant prices.
 *   6. Shopify: SEO + OG metafields (+ taxonomy category, Google feed).
 *   7. Shopify: edition→inventory.
 *   8. Shopify: collection memberships.
 *   9. Shopify: publish to every sales channel.
 *
 * Everything from step 2 on requires a shopify_handle; when the artwork
 * isn't listed yet the function returns right after step 1.
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

  // ── 2. Gelato: push price (so Gelato dashboard isn't stale)
  // Runs BEFORE the shopify_handle guard below: a piece can be live on
  // Gelato but not yet listed on Shopify (pushed, awaiting the finalize
  // step), and in that window a price edit should still reach Gelato.
  // Gated only on gelato_product_id + price, so it no-ops safely for
  // pieces that aren't on Gelato yet.
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

      // Stamp the base print cost per unit for pre-sale margin estimates.
      // Each piece is a single size, so the cheapest variant cost is the
      // per-unit production cost. Non-fatal — this is bookkeeping, not part
      // of the price-sync contract.
      const costs = variants
        .map((v) => v.cost)
        .filter((c): c is number => typeof c === 'number');
      if (costs.length > 0) {
        const unitCost = Math.min(...costs);
        await supabaseAdmin
          .from('artworks')
          .update({ unit_production_cost: unitCost })
          .eq('id', artwork.id);
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

  if (!artwork.shopify_handle) {
    return {
      artworkId,
      shopifyHandle: null,
      gelatoProductId: artwork.gelato_product_id ?? null,
      listingMeta: artwork.listing_meta ?? EMPTY_LISTING_META,
      steps,
      warnings: [
        ...warnings,
        'Artwork has no shopify_handle — Shopify sync skipped. Push to Gelato first or list manually.',
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

  // ── 3. Generate listing_meta if missing
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

  // ── 4. Compute canonical fields
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
  const medium = artist?.id ? await getArtistPrimaryMedium(artist.id) : null;

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
    medium,
  });

  const vendor = artist?.name?.trim() || 'Artinscale';
  const productType = 'Art Print';
  // Retiring a piece pulls it from the storefront: Shopify `draft`
  // removes it from every sales channel while keeping the product (and
  // its handle / history) intact, so a retire is fully reversible by
  // flipping the status back to `listed`. Matches the external-prints
  // retire convention (status=draft).
  const isRetired = artwork.status === 'retired';
  const status: 'active' | 'draft' = isRetired ? 'draft' : 'active';

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
      // Storefront-rendered metafields. The product detail page reads
      // these to render the edition counter, contributor trust signal,
      // and artist bio block above the fold. Plain values so the
      // storefront's GraphQL fragment can read them as
      // `{ value: string }`.
      {
        slot: 'edition_size',
        namespace: 'custom',
        key: 'edition_size',
        value: artwork.edition_size != null ? String(artwork.edition_size) : null,
        type: 'single_line_text_field',
      },
      {
        slot: 'contributor_count',
        namespace: 'custom',
        key: 'contributor_count',
        value: topic ? await getTopicContributorCount(topic.id) : null,
        type: 'single_line_text_field',
      },
      {
        slot: 'artist_bio',
        namespace: 'custom',
        key: 'artist_bio',
        // First paragraph of the bio — keep the storefront unaware of
        // multi-paragraph bios so we don't surface stuff the operator
        // hasn't sanitized for public display.
        value: artist?.bio ? artist.bio.trim().split(/\n\s*\n/)[0]?.trim().slice(0, 400) ?? null : null,
        type: 'multi_line_text_field',
      },
      {
        slot: 'dimensions',
        namespace: 'custom',
        key: 'dimensions',
        // Print size resolved from the artwork's Gelato template, e.g.
        // "30x40 cm / 12x16″". Same string that feeds the description's
        // Dimensions line — kept as its own metafield so the storefront
        // can render it reliably even for products whose description
        // predates the Dimensions line. Community pieces with no
        // explicit size fall back to the default 50x70 print.
        value:
          formatDimensions(productConfig ?? getTemplateConfig(DEFAULT_COMMUNITY_PRODUCT_TYPE)) ||
          null,
        type: 'single_line_text_field',
      },
      {
        slot: 'medium',
        namespace: 'custom',
        key: 'medium',
        // Physical print description (paper, weight) keyed off the
        // Gelato product family. Distinct from the description's
        // "Medium: Digital illustration" line, which is the artwork
        // medium.
        value:
          formatMedium(productConfig ?? getTemplateConfig(DEFAULT_COMMUNITY_PRODUCT_TYPE)) ||
          null,
        type: 'single_line_text_field',
      },
      {
        slot: 'orientation',
        namespace: 'custom',
        key: 'orientation',
        // portrait / landscape / square, groundwork for storefront
        // filtering.
        value:
          formatOrientation(productConfig ?? getTemplateConfig(DEFAULT_COMMUNITY_PRODUCT_TYPE)) ||
          null,
        type: 'single_line_text_field',
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

    // ── 7b. Shopify: standard-taxonomy category
    // Every product is a print, so the category is a constant. Shopify
    // only suggests it in the admin UI; it's never applied unless
    // someone clicks, so the sync sets it explicitly.
    const catRes = await setShopifyProductCategory({
      productId,
      categoryGid: PRINTS_TAXONOMY_CATEGORY_GID,
    });
    steps.push({
      name: 'shopify_category',
      ok: catRes.ok,
      detail: catRes.data,
      error: catRes.error,
    });
    if (!catRes.ok) warnings.push(`shopify_category: ${catRes.error}`);

    // ── 7c. Google & YouTube channel feed fields
    // Art prints carry no GTIN/barcode; Google requires a GTIN, a
    // brand+MPN pair, or an explicit no-identifier flag before it
    // approves a listing. Vendor (brand) is already set on the product,
    // so writing the SKU as MPN completes the pair. Condition is
    // mandatory in the feed. Both live on the *variant* in the channel's
    // `mm-google-shopping` namespace. Age group / gender are apparel
    // fields, intentionally left unset.
    const primaryVariant = productLookup.data.variants[0];
    if (primaryVariant) {
      const googleFields: Array<{ key: string; value: string | null }> = [
        { key: 'condition', value: 'new' },
        { key: 'mpn', value: primaryVariant.sku || artwork.id },
      ];
      const googleResults: Record<string, { ok: boolean; error?: string }> = {};
      for (const f of googleFields) {
        if (!f.value) {
          googleResults[f.key] = { ok: true };
          continue;
        }
        const r = await setShopifyVariantMetafield({
          variantId: primaryVariant.id,
          namespace: 'mm-google-shopping',
          key: f.key,
          value: f.value,
        });
        googleResults[f.key] = { ok: r.ok, error: r.error };
        if (!r.ok) warnings.push(`google_feed ${f.key}: ${r.error}`);
      }
      steps.push({
        name: 'google_feed_fields',
        ok: Object.values(googleResults).every((m) => m.ok),
        detail: googleResults,
      });
    }
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
  // Drive collections from canonical fields, with full reconcile —
  // adds missing targets AND removes orphans within the auto-managed
  // namespace (so changing topic_id / artist_id / clearing
  // edition_size cleans up old collections instead of accumulating).
  // Operator-added collections (e.g. "Bestsellers") survive
  // untouched — they're outside the managed namespace.
  if (productLookup.ok && productLookup.data) {
    const productId = productLookup.data.id;
    const targetEntries: Array<{ title: string; bodyHtml?: string }> = [];
    if (topic?.title) {
      targetEntries.push({
        title: topic.title,
        bodyHtml: buildTopicCollectionBody(topic),
      });
    }
    if (artist?.name) {
      targetEntries.push({
        title: artist.name,
        bodyHtml: buildArtistCollectionBody(artist),
      });
    }
    if (artwork.edition_size != null) {
      targetEntries.push({
        title: 'Limited Edition',
        bodyHtml: LIMITED_EDITION_COLLECTION_BODY,
      });
    }

    // Managed namespace: every topic title + every artist name +
    // "Limited Edition". Anything in the product's current
    // memberships that matches one of these but isn't in
    // targetEntries gets removed. Anything else (Bestsellers, etc.)
    // is left alone.
    const [{ data: allTopics }, { data: allArtists }] = await Promise.all([
      supabaseAdmin.from('topics').select('title'),
      supabaseAdmin.from('users').select('name').eq('role', 'ARTIST'),
    ]);
    const managedTitles = new Set<string>(['Limited Edition']);
    for (const t of allTopics ?? []) {
      if (t?.title) managedTitles.add(t.title);
    }
    for (const a of allArtists ?? []) {
      if (a?.name) managedTitles.add(a.name);
    }

    const reconcile = await reconcileProductCollections({
      productId,
      targetEntries,
      managedTitles,
    });
    steps.push({
      name: 'shopify_collections',
      ok: reconcile.ok,
      detail: reconcile.data,
      error: reconcile.error,
    });
    if (!reconcile.ok && reconcile.error) {
      warnings.push(`shopify_collections: ${reconcile.error}`);
    }
    for (const err of reconcile.data?.errors ?? []) {
      warnings.push(`collection "${err.title}": ${err.message}`);
    }
  }

  // ── 10. Shopify: publish to every sales channel.
  // Shopify's product create defaults to publishing on Online Store
  // only. We want every product on Google & YouTube, Facebook &
  // Instagram, the Artinscale Platform / Headless channels too.
  // Idempotent — re-publishing to an already-published channel is a
  // no-op (the GraphQL mutation handles it). Also covers the case
  // where the operator adds a new sales channel later: the next sync
  // backfills existing products.
  // Skipped for retired pieces — republishing would re-associate the
  // sales channels we're deliberately pulling it from. The `draft`
  // status set above already hides it everywhere; this just avoids
  // fighting that intent on every subsequent sync.
  if (artwork.shopify_product_id && !isRetired) {
    const pubRes = await publishProductToAllChannels({
      productGid: artwork.shopify_product_id,
    });
    steps.push({
      name: 'shopify_channels',
      ok: pubRes.ok && (pubRes.data?.errors.length ?? 0) === 0,
      detail: pubRes.ok
        ? {
            publishedTo: pubRes.data?.publishedTo.map((p) => p.name),
            errors: pubRes.data?.errors,
          }
        : undefined,
      error: pubRes.ok ? undefined : pubRes.error,
    });
    if (!pubRes.ok) {
      warnings.push(`shopify_channels: ${pubRes.error}`);
    } else {
      for (const err of pubRes.data?.errors ?? []) {
        warnings.push(`channel "${err.channel}": ${err.message}`);
      }
    }
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
  '<p>Numbered editions on 250 gsm archival paper, natural matte finish. Each piece in this collection is produced in a fixed run: once the run sells out, it stays sold out.</p>';

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
 * Resolve an artist's medium for the Artwork-details "Medium:" line.
 *
 * Lookup order:
 *   1. `pack.persona.medium` on the artist's primary style pack —
 *      explicit operator override, per artist, no code change.
 *   2. artist_kind === 'studio' → "Archival print". Studio artists
 *      (e.g. Emil Varga, who works in code) sell their pieces as
 *      archival prints, not as the "Digital illustration" default that
 *      fits the AI-rendered community pieces.
 *   3. null — the caller's `buildProductCopy` applies the
 *      "Digital illustration" default.
 */
export async function getArtistPrimaryMedium(
  artistId: string
): Promise<string | null> {
  const [{ data: pack }, { data: user }] = await Promise.all([
    supabaseAdmin
      .from('style_packs')
      .select('id, pack')
      .eq('artist_id', artistId)
      .eq('is_primary', true)
      .maybeSingle(),
    supabaseAdmin.from('users').select('artist_kind').eq('id', artistId).maybeSingle(),
  ]);
  const packMedium = deriveMedium(pack);
  if (packMedium) return packMedium;
  if (user?.artist_kind === 'studio') return 'Archival print';
  return null;
}

/**
 * Medium for the Artwork-details "Medium:" line, read from the artist's
 * primary style pack (`pack.persona.medium`). Returns null when unset so
 * the caller applies the "Digital illustration" default. Mirrors
 * `deriveStyleDescriptor` — operator control via pack JSON, no code change.
 */
function deriveMedium(pack: { id?: string; pack?: unknown } | null): string | null {
  if (!pack) return null;
  const inner = (pack.pack ?? null) as { persona?: { medium?: unknown } } | null;
  const personaMedium = inner?.persona?.medium;
  if (typeof personaMedium === 'string' && personaMedium.trim()) return personaMedium.trim();
  return null;
}

/**
 * Count unique approved-and-public contributors for a topic. Surfaces
 * as the "contributor_count" metafield on the Shopify product — the
 * storefront uses it for the "Made with input from N contributors"
 * trust signal.
 */
async function getTopicContributorCount(topicId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('topic_contributions')
    .select('contributor_email')
    .eq('topic_id', topicId)
    .eq('status', 'approved')
    .eq('show_publicly', true);
  if (!data) return null;
  const unique = new Set(
    (data as Array<{ contributor_email?: string | null }>)
      .map((r) => r.contributor_email)
      .filter((s): s is string => Boolean(s))
  );
  return unique.size > 0 ? String(unique.size) : null;
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
