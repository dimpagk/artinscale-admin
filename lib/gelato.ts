/**
 * Gelato API client
 *
 * Wraps Gelato's eCommerce API for creating storefront products.
 * Phase 1: catalog-based products (no dashboard templates required).
 *
 * Configuration:
 *   - GELATO_API_KEY        — from https://dashboard.gelato.com (Developer → API Key)
 *   - GELATO_STORE_ID       — your store's UUID, also from the Gelato dashboard
 *   - GELATO_DRY_RUN=true   — opt-in mock for local dev / Phase 0 audits without real creds
 *
 * Product UIDs live in `lib/gelato-templates.ts`. Each entry's
 * `productUid` is a discovered SKU from the operator's existing live
 * products (verified 2026-05-09 against the Gelato eCommerce API).
 * No dashboard template setup is required — the unified-format
 * productUid is sent directly to `POST /v1/stores/{id}/products`.
 *
 * Reference: https://dashboard.gelato.com/docs/ecommerce/v1/products/createProduct
 */

import {
  GELATO_TEMPLATES,
  getTemplateConfig,
  isPlaceholderTemplate,
} from './gelato-templates';

const GELATO_API_KEY = process.env.GELATO_API_KEY;
const GELATO_STORE_ID = process.env.GELATO_STORE_ID;
const GELATO_DRY_RUN = process.env.GELATO_DRY_RUN === 'true';
const GELATO_ECOMMERCE_API_BASE = 'https://ecommerce.gelatoapis.com/v1';

export const GELATO_PRODUCT_TYPES = Object.entries(GELATO_TEMPLATES).map(
  ([value, cfg]) => ({
    value,
    label: cfg.label,
    enabledForLaunch: cfg.enabledForLaunch,
  })
);

export type GelatoProductType = keyof typeof GELATO_TEMPLATES;

export interface CreateGelatoProductParams {
  title: string;
  description: string;
  imageUrl: string;
  productType: string;
  /** Optional override for the template UID — bypasses the templates config */
  templateUidOverride?: string;
  /** Tags applied to the Gelato product (and forwarded to Shopify) */
  tags?: string[];
  /** Variant display title — e.g. "40x60 cm / 16x24″ - Vertical" */
  variantTitle?: string;
  /**
   * Top-level Gelato eCommerce-API metadata. Match what existing live
   * products use:
   *   publishImmediately: 'true'        // auto-publish to Shopify
   *   publishWithFreeShipping: 'false'
   *   previewFileType: 'webp'
   *   usedStandardMockup: '1'           // use Gelato's standard mockup
   *   publishScopes: '["product"]'
   *   publishMode: 'bulk_edit'
   * Caller may override; defaults below.
   */
  metadata?: Array<{ key: string; value: string }>;
}

export interface GelatoProductResponse {
  id: string;
  storeId: string;
  title: string;
  status: string;
  /** True when this response was synthesized by GELATO_DRY_RUN, not a real Gelato product */
  isDryRun?: boolean;
}

/**
 * Creates a product in Gelato via the eCommerce API using the
 * documented template-flow contract:
 *
 *   1. GET  /v1/templates/{templateUid}                                — read variants + placeholders
 *   2. POST /v1/stores/{storeId}/products:create-from-template         — create product
 *                                                                        with templateId +
 *                                                                        templateVariantId(s)
 *
 * Why the colon-suffix endpoint: Posting to the bare `/products`
 * endpoint with raw catalog `productUid`s OR with templateVariantId
 * silently drops variants — Gelato returns 200 with `variants: []`
 * (verified empirically 2026-05-09 across 12 different payload shapes).
 * Only the `:create-from-template` action variant of the URL kicks
 * off the variant-creation worker, which populates `variants[]`
 * within ~15s after the synchronous response.
 *
 * Templates are created in the Gelato dashboard once per
 * (product type × size) and their UIDs pasted into
 * `lib/gelato-templates.ts`.
 */
export async function createGelatoProduct(
  params: CreateGelatoProductParams
): Promise<GelatoProductResponse> {
  const config = getTemplateConfig(params.productType);
  const templateUid = params.templateUidOverride ?? config?.templateUid ?? null;
  const productUid = config?.productUid;

  if (!templateUid) {
    throw new Error(
      `No Gelato template configured for product type "${params.productType}". ` +
        `Create one in the dashboard and paste the templateUid into ` +
        `lib/gelato-templates.ts.`
    );
  }

  // Default metadata matches the operator's existing live products
  // (verified 2026-05-09 against Escaping Form / First Language / Held Breath).
  const defaultMetadata = [
    { key: 'publishImmediately', value: 'true' },
    { key: 'publishWithFreeShipping', value: 'false' },
    { key: 'previewFileType', value: 'webp' },
    { key: 'usedStandardMockup', value: '1' },
    { key: 'publishScopes', value: '["product"]' },
    { key: 'publishMode', value: 'bulk_edit' },
  ];
  const finalMetadata = params.metadata ?? defaultMetadata;
  const finalTags = params.tags ?? ['illustration'];
  const variantTitle = params.variantTitle ?? defaultVariantTitle(params.productType);

  // Dry-run mode short-circuits before any real-config checks so the
  // operator can exercise pushToGelatoAction end-to-end without firing
  // a real Gelato API call.
  if (GELATO_DRY_RUN) {
    const dryRunId = `dry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log('[Gelato] DRY RUN — would create product:', {
      id: dryRunId,
      title: params.title,
      description: params.description.slice(0, 200) + (params.description.length > 200 ? '…' : ''),
      productType: params.productType,
      templateUid,
      productUid,
      tags: finalTags,
      variantTitle,
      metadata: finalMetadata,
      imageUrl: params.imageUrl,
    });
    return {
      id: dryRunId,
      storeId: GELATO_STORE_ID ?? 'dry-run',
      title: params.title,
      status: 'dry_run',
      isDryRun: true,
    };
  }

  if (!GELATO_API_KEY || !GELATO_STORE_ID) {
    throw new Error(
      'Gelato credentials missing. Set GELATO_API_KEY and GELATO_STORE_ID, ' +
        'or set GELATO_DRY_RUN=true for local testing without a live Gelato account.'
    );
  }

  if (isPlaceholderTemplate(templateUid)) {
    throw new Error(
      `Gelato templateUid for "${params.productType}" is still a placeholder. ` +
        `Replace the placeholder with the real template UID from your Gelato ` +
        `dashboard (dashboard.gelato.com/templates/<uuid>).`
    );
  }

  // Step 1 — fetch the template to learn its variant ids + image
  // placeholder slot names. Each placeholder has a `name` set when the
  // template was created (typically the original sample design's
  // filename, e.g. "genesis.jpg"). When we POST the new product, we
  // reference that exact name so Gelato knows which slot to fill.
  const tmplRes = await fetch(
    `${GELATO_ECOMMERCE_API_BASE}/templates/${templateUid}`,
    { headers: { 'X-API-KEY': GELATO_API_KEY } }
  );
  if (!tmplRes.ok) {
    const errorBody = await tmplRes.text();
    throw new Error(
      `Failed to fetch Gelato template ${templateUid} (${tmplRes.status}): ${errorBody}`
    );
  }
  const template = (await tmplRes.json()) as {
    id: string;
    variants: Array<{
      id: string;
      title: string;
      productUid: string;
      imagePlaceholders: Array<{ name: string; printArea: string }>;
    }>;
  };

  if (!template.variants || template.variants.length === 0) {
    throw new Error(
      `Gelato template ${templateUid} has no variants — open it in the dashboard ` +
        `and confirm the size + paper config saved correctly.`
    );
  }

  // Step 2 — build the create-product payload using templateVariantId +
  // matched placeholder names. Single-size templates have one variant;
  // multi-size templates would have several (we'd fill them all with
  // the same artwork URL since color/size variants get the same design).
  const variants = template.variants.map((v) => ({
    templateVariantId: v.id,
    imagePlaceholders: v.imagePlaceholders.map((ph) => ({
      name: ph.name,
      fileUrl: params.imageUrl,
      fitMethod: 'slice' as const,
    })),
  }));

  // The `:create-from-template` URL suffix is the canonical
  // endpoint for template-driven product creation. Posting to the
  // bare `/products` endpoint silently drops variants (returns 200
  // but `variants: []`). The colon-suffix is non-standard REST but
  // documented:
  // https://dashboard.gelato.com/docs/ecommerce/products/create-from-template/
  const response = await fetch(
    `${GELATO_ECOMMERCE_API_BASE}/stores/${GELATO_STORE_ID}/products:create-from-template`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': GELATO_API_KEY,
      },
      body: JSON.stringify({
        templateId: templateUid,
        title: params.title,
        description: params.description,
        // `isVisibleInTheOnlineStore` is the documented field name
        // for the create-from-template endpoint (vs `isReadyToPublish`
        // on the bare /products endpoint).
        isVisibleInTheOnlineStore: true,
        salesChannels: ['web'],
        tags: finalTags,
        metadata: finalMetadata,
        variants,
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gelato API error (${response.status} ${response.statusText}): ${errorBody}`
    );
  }

  const data = (await response.json()) as {
    id?: string;
    storeId?: string;
    title?: string;
    status?: string;
  };

  if (!data.id) {
    throw new Error(
      `Gelato API returned 2xx but no product id. Body: ${JSON.stringify(data)}`
    );
  }

  return {
    id: data.id,
    storeId: data.storeId ?? GELATO_STORE_ID,
    title: data.title ?? params.title,
    status: data.status ?? 'created',
  };
}

/**
 * List the variants of a Gelato product. Used by the sync library to
 * discover the variant ids it needs to PUT prices against.
 *
 * Endpoint:
 *   GET /v1/stores/{storeId}/products/{productId}/variants
 *
 * Returns the variant id, the connected Shopify variant id, current
 * price/cost, and other details. Throws on non-2xx.
 */
export interface GelatoVariantSummary {
  id: string;
  title: string;
  productUid: string;
  externalVariantId: string | null;
  price: number | null;
  cost: number | null;
  currency: string | null;
  connectionStatus: string | null;
}

export async function listGelatoProductVariants(
  productId: string
): Promise<GelatoVariantSummary[]> {
  if (GELATO_DRY_RUN) {
    console.log('[Gelato] DRY RUN — listGelatoProductVariants', { productId });
    return [];
  }
  if (!GELATO_API_KEY || !GELATO_STORE_ID) {
    throw new Error('Gelato credentials missing');
  }
  const res = await fetch(
    `${GELATO_ECOMMERCE_API_BASE}/stores/${GELATO_STORE_ID}/products/${productId}/variants`,
    { headers: { 'X-API-KEY': GELATO_API_KEY } }
  );
  if (!res.ok) {
    throw new Error(`Gelato variant list ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    productVariants?: Array<{
      id: string;
      title: string;
      productUid: string;
      externalVariantId: string | null;
      price: number | null;
      cost: number | null;
      currency: string | null;
      connectionStatus: string | null;
    }>;
  };
  return (body.productVariants ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    productUid: v.productUid,
    externalVariantId: v.externalVariantId,
    price: v.price,
    cost: v.cost,
    currency: v.currency,
    connectionStatus: v.connectionStatus,
  }));
}

/**
 * Update the retail price on a Gelato variant.
 *
 * Important: Gelato does NOT propagate post-create price changes to
 * Shopify automatically (verified empirically 2026-05-10 — the price
 * stayed at the template-default value on the linked Shopify variant
 * for 2+ minutes after a Gelato PUT). This call keeps the Gelato
 * dashboard accurate; the listing-sync library is responsible for the
 * matching Shopify-side update.
 */
export async function updateGelatoVariantPrice(args: {
  productId: string;
  variantId: string;
  price: number;
  currency?: string;
}): Promise<void> {
  if (GELATO_DRY_RUN) {
    console.log('[Gelato] DRY RUN — would update variant price', args);
    return;
  }
  if (!GELATO_API_KEY || !GELATO_STORE_ID) {
    throw new Error('Gelato credentials missing');
  }
  const res = await fetch(
    `${GELATO_ECOMMERCE_API_BASE}/stores/${GELATO_STORE_ID}/products/${args.productId}/variants/${args.variantId}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': GELATO_API_KEY,
      },
      body: JSON.stringify({
        price: args.price,
        currency: args.currency ?? 'EUR',
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gelato variant PUT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/**
 * Variant-title default — delegates to the shared product-copy module.
 * Kept here as a re-export so existing internal callers (e.g. the
 * dry-run preview inside `createGelatoProduct`) don't have to import
 * from a different file.
 */
export function defaultVariantTitle(productType: string): string {
  const cfg = getTemplateConfig(productType);
  if (!cfg) return productType;
  // Inline import-free version that mirrors lib/product-copy.ts —
  // intentionally duplicated here (one short helper) to avoid a runtime
  // circular dependency since lib/product-copy.ts imports from
  // lib/gelato-templates.ts.
  const cmStr = `${cfg.widthCm}x${cfg.heightCm} cm`;
  const w = Math.round((cfg.widthCm / 2.54) * 10) / 10;
  const h = Math.round((cfg.heightCm / 2.54) * 10) / 10;
  const orient = cfg.heightCm >= cfg.widthCm ? 'Vertical' : 'Horizontal';
  return `${cmStr} / ${w}x${h}″ - ${orient}`;
}
