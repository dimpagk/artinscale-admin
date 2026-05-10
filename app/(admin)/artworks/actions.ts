'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createArtwork,
  updateArtwork,
  deleteArtwork,
  getArtworkById,
} from '@/lib/artworks';
import { createGelatoProduct } from '@/lib/gelato';
import { getTemplateConfig } from '@/lib/gelato-templates';
import { buildProductCopy } from '@/lib/product-copy';
import { syncArtworkToShopify, getArtistPrimaryStyle } from '@/lib/listing-sync';
import { generateListingMeta } from '@/lib/agents/listing-generator';
import { getProductDefaults } from '@/lib/pricing-defaults';
import { ensureUpscaledForArtworkImage } from '@/lib/upscale-runner';
import {
  applyListedState,
  autoPublishArtworkAfterGelatoCreate,
} from '@/lib/post-create-publisher';
import { EMPTY_LISTING_META, type ListingMeta } from '@/lib/types';
import { startAgentTask, finishAgentTask } from '@/lib/agents/base';
import { validatePrintSafety } from '@/lib/image-dimensions';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Decide whether a string field change is "substantial enough" to
 * warrant regenerating the listing_meta SEO/OG copy. Same-string and
 * trivial whitespace edits return false; everything else returns true.
 *
 * Used by `updateArtworkAction` to gate `regenerate: true` on the
 * listing-sync — keeps the agent from re-running on unrelated edits
 * (price tweaks, status flips) while staying responsive to the title /
 * description / topic changes that DO change the SEO copy.
 */
function isMetaAffectingChange(prev: string | null, next: string | null): boolean {
  const a = (prev ?? '').trim();
  const b = (next ?? '').trim();
  return a !== b;
}

/**
 * If `image_url` came from a `generated_images` row, return the artist
 * UUID inferred from that row's `metadata.stylePackPersonaUserId`.
 *
 * Used by createArtworkAction / updateArtworkAction to:
 *   1. Auto-fill `artist_id` when the operator picked a generated image
 *      and didn't pick an artist explicitly.
 *   2. Warn (in server logs) when the operator's explicit artist
 *      mismatches the image's style-pack persona — silent drift here
 *      breaks downstream voice (drop campaign drafter etc).
 */
async function inferredArtistFromImage(
  imageUrl: string | null
): Promise<string | null> {
  if (!imageUrl) return null;
  const { data } = await supabaseAdmin
    .from('generated_images')
    .select('metadata')
    .eq('image_url', imageUrl)
    .maybeSingle();
  const meta = (data as { metadata?: Record<string, unknown> } | null)?.metadata;
  const personaUserId = meta?.stylePackPersonaUserId;
  return typeof personaUserId === 'string' && personaUserId.length > 0
    ? personaUserId
    : null;
}

function reconcileArtist(
  formArtistId: string | null,
  inferred: string | null,
  artworkTitleForLog: string
): string | null {
  if (!inferred) return formArtistId;
  if (!formArtistId) {
    // No explicit choice — adopt the inferred artist so downstream
    // agents pick the right voice.
    return inferred;
  }
  if (formArtistId !== inferred) {
    console.warn(
      `[artworks] Artist mismatch on "${artworkTitleForLog}": form picked ${formArtistId}, ` +
        `but image's style pack persona is ${inferred}. ` +
        `Keeping operator's explicit choice — but downstream agents (drop campaign, ` +
        `comment reply, email) will use the artist's style pack, not the image's.`
    );
  }
  return formArtistId;
}

export async function createArtworkAction(formData: FormData) {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const imageUrl = formData.get('image_url') as string;
  const artistId = formData.get('artist_id') as string;
  const topicId = formData.get('topic_id') as string;
  const status = formData.get('status') as string;
  const editionSize = formData.get('edition_size') as string;
  const editionSold = formData.get('edition_sold') as string;
  const price = formData.get('price') as string;
  const currency = formData.get('currency') as string;
  const productType = formData.get('product_type') as string;
  const inspirationSummary = formData.get('inspiration_summary') as string;

  const inferred = await inferredArtistFromImage(imageUrl || null);
  const finalArtistId = reconcileArtist(artistId || null, inferred, title);

  // Apply per-product-type defaults when the form fields are empty.
  // Mirrors the client-side prefill in artwork-form so the result is
  // identical whether the operator confirmed the prefilled values or
  // submitted with empty fields (e.g. via the Quick Add flow).
  const defaults = getProductDefaults(productType || null);
  const finalPrice = price
    ? parseFloat(price)
    : defaults?.price ?? null;
  const finalEditionSize = editionSize
    ? parseInt(editionSize)
    : defaults?.editionSize ?? null;
  const finalCurrency = currency || defaults?.currency || 'EUR';

  await createArtwork({
    title,
    description: description || null,
    image_url: imageUrl || null,
    artist_id: finalArtistId,
    topic_id: topicId || null,
    status: status || 'created',
    edition_size: finalEditionSize,
    edition_sold: editionSold ? parseInt(editionSold) : 0,
    price: finalPrice,
    currency: finalCurrency,
    product_type: productType || null,
    inspiration_summary: inspirationSummary || null,
  });

  // Auto-upscale: print-safety guardrail rejects 1024×1024 against
  // any of our museum-poster sizes. Fire the upscale in the background
  // via agent_tasks so the operator can keep working while it runs
  // (~30s for 4x via Real-ESRGAN). Idempotent — skips if already
  // upscaled.
  if (imageUrl) {
    try {
      // No correlationId here — the artwork was just created and we
      // don't have the new id back from createArtwork's signature.
      // Could plumb it through if grouping pre-listing tasks becomes
      // valuable; for now upscale tasks live un-correlated.
      const task = await startAgentTask({
        agentName: 'upscaler',
        triggerKind: 'event',
        input: { source: 'createArtworkAction', image_url: imageUrl },
      });
      if (task) {
        void ensureUpscaledForArtworkImage(imageUrl)
          .then((result) =>
            finishAgentTask(task.id, {
              status: 'succeeded',
              output: result as unknown as Record<string, unknown>,
            })
          )
          .catch((err) =>
            finishAgentTask(task.id, {
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
            })
          );
      }
    } catch (err) {
      console.error('auto-upscale trigger failed (non-fatal):', err);
    }
  }

  revalidatePath('/artworks');
  redirect('/artworks');
}

export async function updateArtworkAction(id: string, formData: FormData) {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const imageUrl = formData.get('image_url') as string;
  const artistId = formData.get('artist_id') as string;
  const topicId = formData.get('topic_id') as string;
  const status = formData.get('status') as string;
  const editionSize = formData.get('edition_size') as string;
  const editionSold = formData.get('edition_sold') as string;
  const price = formData.get('price') as string;
  const currency = formData.get('currency') as string;
  const productType = formData.get('product_type') as string;
  const inspirationSummary = formData.get('inspiration_summary') as string;

  const inferred = await inferredArtistFromImage(imageUrl || null);
  const finalArtistId = reconcileArtist(artistId || null, inferred, title);

  const newEditionSize = editionSize ? parseInt(editionSize) : null;
  const newEditionSold = editionSold ? parseInt(editionSold) : 0;

  // Listing meta — if the operator edited any of the 4 SEO/OG fields,
  // those become a "manual" override that the agent will respect.
  const lmSeoTitle = (formData.get('listing_meta_seo_title') as string | null)?.trim() || null;
  const lmSeoDesc = (formData.get('listing_meta_seo_description') as string | null)?.trim() || null;
  const lmOgTitle = (formData.get('listing_meta_og_title') as string | null)?.trim() || null;
  const lmOgDesc = (formData.get('listing_meta_og_description') as string | null)?.trim() || null;

  // Capture pre-update state so we can detect substantial changes that
  // warrant a listing_meta regeneration (title, description,
  // inspiration_summary, edition_size, product_type, topic_id all
  // affect the SEO/OG copy).
  const prev = await getArtworkById(id);

  // Detect manual edits to the listing_meta fields. If any differ from
  // existing values, persist them with generatedBy='manual' so the
  // agent stops auto-overwriting on subsequent syncs.
  const prevMeta: ListingMeta = prev?.listing_meta ?? EMPTY_LISTING_META;
  const metaEdited =
    (lmSeoTitle ?? null) !== (prevMeta.seoTitle ?? null) ||
    (lmSeoDesc ?? null) !== (prevMeta.seoDescription ?? null) ||
    (lmOgTitle ?? null) !== (prevMeta.ogTitle ?? null) ||
    (lmOgDesc ?? null) !== (prevMeta.ogDescription ?? null);
  const nextMeta: ListingMeta | null = metaEdited
    ? {
        seoTitle: lmSeoTitle,
        seoDescription: lmSeoDesc,
        ogTitle: lmOgTitle,
        ogDescription: lmOgDesc,
        generatedAt: new Date().toISOString(),
        generatedBy: 'manual',
      }
    : null;

  // Sold-out detection: when edition_sold catches up to edition_size,
  // auto-transition status to 'sold'. The operator can override after
  // the fact (e.g. to extend the edition). This runs even if the
  // operator left status untouched in the form.
  let finalStatus = status;
  const isLimitedEdition = newEditionSize != null && newEditionSize > 0;
  const justSoldOut =
    isLimitedEdition &&
    newEditionSold >= newEditionSize &&
    (prev?.edition_sold ?? 0) < (prev?.edition_size ?? Infinity);
  if (isLimitedEdition && newEditionSold >= newEditionSize && finalStatus !== 'sold') {
    finalStatus = 'sold';
  }

  await updateArtwork(id, {
    title,
    description: description || null,
    image_url: imageUrl || null,
    artist_id: finalArtistId,
    topic_id: topicId || null,
    status: finalStatus,
    edition_size: newEditionSize,
    edition_sold: newEditionSold,
    price: price ? parseFloat(price) : null,
    currency: currency || 'EUR',
    product_type: productType || null,
    inspiration_summary: inspirationSummary || null,
    ...(nextMeta ? { listing_meta: nextMeta } : {}),
  });

  // Sold-out notice — fires once on the transition edge, never on
  // subsequent updates. Lands in agent_tasks so the operator sees it
  // in the same feed where mockup runs / drop drafts surface. Suggest
  // a follow-up: extend the edition, generate a successor piece, or
  // archive.
  if (justSoldOut && prev) {
    try {
      const task = await startAgentTask({
        agentName: 'sold-out-notice',
        triggerKind: 'event',
        correlationId: `artwork:${id}`,
        input: { artwork_id: id, title: prev.title, edition_size: newEditionSize },
      });
      if (task) {
        await finishAgentTask(task.id, {
          status: 'succeeded',
          output: {
            message: `"${prev.title}" sold out (${newEditionSold}/${newEditionSize}). Consider extending the edition, generating a successor, or archiving.`,
            soldAt: new Date().toISOString(),
            artworkId: id,
            edition: { sold: newEditionSold, total: newEditionSize },
          },
        });
      }
    } catch (err) {
      console.error('sold-out notice failed (non-fatal):', err);
    }
  }

  // Push the edited canonical state to Shopify + Gelato. Skipped if
  // the artwork isn't listed yet (no shopify_handle). Failures are
  // surfaced in logs but don't block the operator's edit — each step
  // is independent and recorded on the result.
  //
  // Regenerate listing_meta when an SEO-affecting field changed AND
  // the operator hasn't manually edited the SEO copy in this same
  // submit. Manual edits always win — flipping `generatedBy='manual'`
  // (above) is enough to make the agent skip on subsequent syncs, but
  // we explicitly suppress regen here so the agent doesn't fire and
  // immediately overwrite the manual values.
  if (prev?.shopify_handle) {
    const sourceFieldsChanged =
      isMetaAffectingChange(prev.title, title) ||
      isMetaAffectingChange(prev.description, description || null) ||
      isMetaAffectingChange(prev.inspiration_summary, inspirationSummary || null) ||
      prev.edition_size !== newEditionSize ||
      prev.product_type !== (productType || null) ||
      prev.topic_id !== (topicId || null);
    const shouldRegen = sourceFieldsChanged && !metaEdited;
    const sync = await syncArtworkToShopify(id, {
      regenerate: shouldRegen,
      skipAgent: !shouldRegen,
    });
    if (sync.warnings.length > 0) {
      console.warn(
        `[artworks] listing-sync warnings for ${prev.shopify_handle}:`,
        sync.warnings
      );
    }
  }

  revalidatePath('/artworks');
  redirect('/artworks');
}

export async function deleteArtworkAction(id: string) {
  await deleteArtwork(id);
  revalidatePath('/artworks');
  redirect('/artworks');
}

/**
 * Regenerate the listing_meta for an artwork via the listing-generator
 * agent (force=true so it overrides whatever's there, including manual
 * edits). Then push the new SEO/OG copy to Shopify metafields by
 * running the listing-sync.
 *
 * Called from the "Regenerate" button in the Listing copy card on the
 * artwork edit page. Returns the new ListingMeta so the form can
 * update its inputs without a full reload.
 */
export async function regenerateListingMetaAction(id: string): Promise<ListingMeta> {
  const result = await generateListingMeta({ artworkId: id, force: true });

  // Push the freshly-generated SEO/OG copy to Shopify metafields.
  // No-op when the artwork isn't listed yet — the next sync (after
  // listing) will pick up the new meta.
  const artwork = await getArtworkById(id);
  if (artwork?.shopify_handle) {
    const sync = await syncArtworkToShopify(id, { skipAgent: true });
    if (sync.warnings.length > 0) {
      console.warn(`[artworks] regen sync warnings:`, sync.warnings);
    }
  }

  revalidatePath(`/artworks/${id}`);
  return result.listingMeta;
}

export async function pushToGelatoAction(id: string) {
  const artwork = await getArtworkById(id);
  if (!artwork) throw new Error('Artwork not found');
  if (!artwork.image_url) throw new Error('Artwork must have an image URL to push to Gelato');

  const productType = artwork.product_type || 'museum-poster-21x30';

  // If the original image was upscaled at some point, prefer the
  // upscaled URL — print-safety check should pass then.
  const upscaledUrl = await findUpscaledImageUrl(artwork.image_url);
  const sourceImageUrl = upscaledUrl ?? artwork.image_url;

  // Print-safety guardrail (PHASE_0_AUDIT §3.6) — refuses pushes for
  // images smaller than the template's minimum print-safe dimensions.
  await validatePrintSafety(sourceImageUrl, productType);

  // Fetch artist and topic so we can build a Gelato product description
  // that matches the operator's existing live products' shape (artwork
  // synopsis → collection framing → structured artwork details).
  const [{ data: artist }, { data: topic }] = await Promise.all([
    artwork.artist_id
      ? supabaseAdmin.from('users').select('name, bio').eq('id', artwork.artist_id).maybeSingle()
      : Promise.resolve({ data: null }),
    artwork.topic_id
      ? supabaseAdmin.from('topics').select('id, title, description').eq('id', artwork.topic_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Build product copy via the shared template — same shape that the
  // storefront product page renders, so SEO/meta is consistent
  // end-to-end without duplicate templating.
  const editionLabel =
    artwork.edition_size != null
      ? `${artwork.edition_sold ?? 0} of ${artwork.edition_size}`
      : 'Open edition';
  const style = artwork.artist_id ? await getArtistPrimaryStyle(artwork.artist_id) : null;
  const copy = buildProductCopy({
    title: artwork.title,
    artworkSynopsis: artwork.description || null,
    inspirationSummary: artwork.inspiration_summary || null,
    artistName: artist?.name ?? 'an Artinscale artist',
    artistBio: artist?.bio ?? null,
    topicTitle: topic?.title ?? null,
    topicId: topic?.id ?? null,
    productConfig: getTemplateConfig(productType),
    editionLabel,
    style,
  });

  const result = await createGelatoProduct({
    title: artwork.title,
    description: copy.description,
    imageUrl: sourceImageUrl,
    productType,
    tags: copy.tags,
    variantTitle: copy.variantTitle,
  });

  await updateArtwork(id, {
    gelato_product_id: result.id,
    gelato_store_id: result.storeId,
  });

  // Auto-publisher: poll Gelato until the auto-publish to Shopify
  // lands (~15s typical), grab the handle from the Gelato GET, then
  // run the same chain that markArtworkAsListedAction does — so the
  // operator no longer has to copy-paste the Shopify handle back.
  //
  // Wrapped in agent_tasks so the operator can watch progress on the
  // artwork edit page. Background fire — this action returns
  // immediately. Falls back to manual Mark-as-Listed if the poll
  // times out (status='timeout' surfaces in the agent_task output).
  try {
    const task = await startAgentTask({
      agentName: 'auto-publisher',
      triggerKind: 'event',
      correlationId: `artwork:${id}`,
      input: { artwork_id: id, source: 'pushToGelatoAction' },
    });
    if (task) {
      void autoPublishArtworkAfterGelatoCreate({ artworkId: id })
        .then((res) =>
          finishAgentTask(task.id, {
            status: res.status === 'published' ? 'succeeded' : 'failed',
            output: res as unknown as Record<string, unknown>,
            error: res.status === 'published' ? undefined : res.message,
          })
        )
        .catch((err) =>
          finishAgentTask(task.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
        );
    }
  } catch (err) {
    console.error('auto-publisher trigger failed (non-fatal):', err);
  }

  revalidatePath(`/artworks/${id}`);
  revalidatePath('/artworks');
}

/**
 * If the original image was upscaled (via /api/art-generator/[id]/upscale),
 * prefer the upscaled URL. Lookup is by `image_url` against the
 * generated_images metadata — so it works even when artworks were
 * created before the upscale ran.
 */
async function findUpscaledImageUrl(originalUrl: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('generated_images')
    .select('metadata')
    .eq('image_url', originalUrl)
    .maybeSingle();

  const meta = (data as { metadata?: Record<string, unknown> } | null)?.metadata;
  const upscaledUrl = meta?.upscaledImageUrl;
  if (typeof upscaledUrl === 'string' && upscaledUrl.length > 0) {
    return upscaledUrl;
  }
  return null;
}

/**
 * Mark an artwork as live on Shopify.
 *
 * Gelato auto-publishes products to the connected Shopify store, but no
 * webhook in this codebase tells the admin when that has happened. The
 * operator runs this action after confirming the Shopify product is live,
 * pasting in the Shopify handle (and optionally the GID).
 *
 * Side effects:
 *   1. Stores `shopify_handle` and `shopify_product_id` on the artwork row
 *   2. Transitions status to `listed`
 *   3. If the artwork is linked to a topic, inserts into the storefront's
 *      `product_topics(shopify_handle, topic_id)` so the storefront can
 *      render the "Story Behind This Artwork" block on the product page
 */
export async function markArtworkAsListedAction(id: string, formData: FormData) {
  const shopifyHandle = (formData.get('shopify_handle') as string)?.trim();
  const shopifyProductId = (formData.get('shopify_product_id') as string)?.trim();

  if (!shopifyHandle) {
    throw new Error('Shopify handle is required to mark an artwork as listed.');
  }

  // Manual fallback path. After the auto-publisher landed, this is
  // mostly a "force re-sync" button. The shared `applyListedState`
  // helper does:
  //   - persist shopify_handle + shopify_product_id + status='listed'
  //   - linkProductToTopic
  //   - run full listing-sync (with agent on first-time listings)
  //   - fire mockup pipeline in background
  //   - fire drop campaign drafter
  await applyListedState({
    artworkId: id,
    shopifyHandle,
    shopifyProductId: shopifyProductId || null,
    triggerKind: 'manual',
  });

  revalidatePath(`/artworks/${id}`);
  revalidatePath('/artworks');
}
