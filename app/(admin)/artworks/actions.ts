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
import { getTemplateConfig, pickLargestPrintSize, SMALLEST_TEMPLATE } from '@/lib/gelato-templates';
import { buildProductCopy } from '@/lib/product-copy';
import { syncArtworkToShopify, getArtistPrimaryStyle, getArtistPrimaryMedium } from '@/lib/listing-sync';
import { generateListingMeta } from '@/lib/agents/listing-generator';
import {
  draftArtworkFields,
  type ArtworkFieldDraft,
} from '@/lib/agents/artwork-field-drafter';
import { getProductDefaults } from '@/lib/pricing-defaults';
import { resolveCreationCost } from '@/lib/costs/creation-cost';
import { syncArtworkCostEntries } from '@/lib/costs/cost-entries';
import { ensureUpscaledForArtworkImage } from '@/lib/upscale-runner';
import { applyListedState } from '@/lib/post-create-publisher';
import { runSoldOutFollowUp } from '@/lib/agents/sold-out-follow-up';
import { EMPTY_LISTING_META, type ListingMeta, type ArtworkCreationSource } from '@/lib/types';
import { startAgentTask, finishAgentTask } from '@/lib/agents/base';
import { validatePrintSafety, fetchImageDimensions } from '@/lib/image-dimensions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  createSocialDraft,
  type SocialDraftArtwork,
  type SocialDraftKind,
  type SocialDraftResult,
} from '@/lib/social-drafts';

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
  const formSource = ((formData.get('creation_source') as string) || 'ai') as ArtworkCreationSource;
  const creationCostRaw = formData.get('creation_cost') as string;

  const inferred = await inferredArtistFromImage(imageUrl || null);
  const finalArtistId = reconcileArtist(artistId || null, inferred, title);

  // Creation cost (Layer 1). Source + prefill are resolved from the assigned
  // artist's kind: AI estimates from the generation ledger, community uses
  // the configurable default flat fee, public-domain is free. An
  // operator-entered value always wins. See lib/costs/creation-cost.ts.
  const creation = await resolveCreationCost({
    imageUrl: imageUrl || null,
    artistId: finalArtistId,
    providedCost: creationCostRaw ? parseFloat(creationCostRaw) : null,
    formSource,
  });

  // Apply per-product-type defaults when the form fields are empty.
  // Mirrors the client-side prefill in artwork-form so the result is
  // identical whether the operator confirmed the prefilled values or
  // submitted with empty fields (e.g. via the Quick Add flow).
  //
  // Edition is the exception: new pieces default to an OPEN edition, so an
  // empty field stays null (unlimited) rather than falling back to a
  // limited default. The operator sets a limit explicitly when they want
  // one.
  const defaults = getProductDefaults(productType || null);
  const finalPrice = price
    ? parseFloat(price)
    : defaults?.price ?? null;
  const finalEditionSize = editionSize ? parseInt(editionSize) : null;
  const finalCurrency = currency || defaults?.currency || 'EUR';

  const newArtworkId = await createArtwork({
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
    creation_source: creation.source,
    creation_cost: creation.cost,
    creation_cost_currency: creation.currency,
    creation_cost_breakdown: creation.breakdown,
  });

  // Book the non-AI creation cost (upscale + mockups, purchase, community
  // flat fee) into the dated P&L ledger. Non-fatal: a ledger hiccup must
  // not fail the save. AI generation spend is booked from generated_images.
  try {
    await syncArtworkCostEntries({
      artworkId: newArtworkId,
      source: creation.source,
      breakdown: creation.breakdown,
      currency: creation.currency,
    });
  } catch (err) {
    console.error('cost-entry sync failed (non-fatal):', err);
  }

  // Auto-upscale: enlarge the base to the largest size it can print at
  // 300 DPI (Real-ESRGAN for small jumps, Clarity for 60×90 / 70×100).
  // Fire in the background via agent_tasks so the operator can keep
  // working while it runs (Clarity can take ~1-2 min). Idempotent —
  // skips if already upscaled; pushToGelatoAction also ensures it.
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
  const formSource = ((formData.get('creation_source') as string) || 'ai') as ArtworkCreationSource;
  const creationCostRaw = formData.get('creation_cost') as string;

  const inferred = await inferredArtistFromImage(imageUrl || null);
  const finalArtistId = reconcileArtist(artistId || null, inferred, title);

  // Resolve creation source + cost from the artist's kind (operator-entered
  // cost wins). The edit form prefills the field with the existing value, so
  // an unchanged submit preserves it; clearing the field re-prefills.
  const creation = await resolveCreationCost({
    imageUrl: imageUrl || null,
    artistId: finalArtistId,
    providedCost: creationCostRaw ? parseFloat(creationCostRaw) : null,
    formSource,
  });

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
  if (
    isLimitedEdition &&
    newEditionSold >= newEditionSize &&
    finalStatus !== 'sold' &&
    finalStatus !== 'retired'
  ) {
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
    creation_source: creation.source,
    creation_cost: creation.cost,
    creation_cost_currency: creation.currency,
    creation_cost_breakdown: creation.breakdown,
    ...(nextMeta ? { listing_meta: nextMeta } : {}),
  });

  // Keep the P&L ledger in step with the edited creation cost. Upserts by
  // source_key so the original booking date is preserved. Non-fatal.
  try {
    await syncArtworkCostEntries({
      artworkId: id,
      source: creation.source,
      breakdown: creation.breakdown,
      currency: creation.currency,
    });
  } catch (err) {
    console.error('cost-entry sync failed (non-fatal):', err);
  }

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

    // Sold-out follow-up agent — drafts a successor piece proposal
    // into the approval queue (item_type='artwork'). Runs in the
    // background so a manual edit doesn't block on the LLM call.
    // Non-fatal: the artwork update succeeds even if the agent
    // errors. Wrapped in agent_tasks so the operator can see it ran.
    try {
      const followUpTask = await startAgentTask({
        agentName: 'sold-out-follow-up',
        triggerKind: 'event',
        correlationId: `artwork:${id}`,
        input: { artwork_id: id },
      });
      if (followUpTask) {
        void runSoldOutFollowUp({ artworkId: id })
          .then((result) =>
            finishAgentTask(followUpTask.id, {
              status: result.queueItemId ? 'succeeded' : 'failed',
              output: {
                queueItemId: result.queueItemId,
                proposal: result.proposal as unknown as Record<string, unknown>,
              },
              error: result.queueItemId ? undefined : 'No valid proposal generated',
            })
          )
          .catch((err) =>
            finishAgentTask(followUpTask.id, {
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
            })
          );
      }
    } catch (err) {
      console.error('sold-out follow-up trigger failed (non-fatal):', err);
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

  // Idempotency guard: never create a second Gelato product. Server
  // actions can be retried (e.g. after a transient network error or a
  // dev-server restart), and without this a retry would create a
  // DUPLICATE Gelato product. If the artwork already carries a
  // gelato_product_id we're done here: the finalize_listings cron polls
  // Gelato and completes the listing once it publishes.
  if (artwork.gelato_product_id) {
    revalidatePath(`/artworks/${id}`);
    revalidatePath('/artworks');
    return;
  }

  // Ensure the size-aware print master exists: the upscaler enlarges the
  // 4K base to the largest size it can print at 300 DPI (Real-ESRGAN for
  // small jumps, Clarity for 60×90 / 70×100). Idempotent — reuses the
  // create-time job's output when ready, else runs it now so the piece is
  // never sized off the un-upscaled base.
  let sourceImageUrl = artwork.image_url;
  try {
    const up = await ensureUpscaledForArtworkImage(artwork.image_url);
    if ('upscaledImageUrl' in up && up.upscaledImageUrl) {
      sourceImageUrl = up.upscaledImageUrl;
    }
  } catch (err) {
    console.warn('[push] upscale ensure failed, using original image:', err);
  }

  // Every piece gets exactly ONE size, and it's the largest this master
  // can print at museum-quality DPI (300). If the operator already pinned
  // a product_type we honor it; otherwise we derive the size from the
  // upscaled master and persist it + its pricing defaults, so the artwork
  // carries a single, resolution-appropriate dimension.
  let productType = artwork.product_type;
  if (!productType) {
    const dims = await fetchImageDimensions(sourceImageUrl);
    const picked = (dims && pickLargestPrintSize(dims.width, dims.height)) || SMALLEST_TEMPLATE;
    productType = picked;
    const defaults = getProductDefaults(picked);
    await updateArtwork(id, {
      product_type: picked,
      ...(artwork.price == null && defaults ? { price: defaults.price } : {}),
      ...(artwork.edition_size == null && defaults ? { edition_size: defaults.editionSize } : {}),
    });
  }

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
  const medium = artwork.artist_id ? await getArtistPrimaryMedium(artwork.artist_id) : null;
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
    medium,
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

  // The Gelato product is created; the listing is completed by the
  // `finalize_listings` cron (every 15 min), which polls Gelato until it
  // has published to Shopify, then runs the full applyListedState chain
  // (handle, price, metafields, channels, mockups, status → listed).
  //
  // We deliberately do NOT poll/publish inline here. Gelato's
  // publish-to-Shopify is asynchronous and can take minutes to hours, so
  // a poll inside this request would either block the operator or, worse,
  // run as a detached promise after the response, which crashes the dev
  // server and is silently dropped on serverless (the request freezes
  // once it returns). The cron is the durable, environment-agnostic path;
  // the operator can also trigger it immediately with Mark-as-Listed.

  revalidatePath(`/artworks/${id}`);
  revalidatePath('/artworks');
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

/**
 * Draft every listing field for operator review: title, description,
 * SEO/OG copy (one Claude call) plus deterministic product size, price,
 * edition and currency suggestions. Persists NOTHING: the form fills the
 * suggestions in as highlighted values and only Save writes them.
 */
export async function draftArtworkFieldsAction(id: string): Promise<ArtworkFieldDraft> {
  return draftArtworkFields(id);
}

/**
 * Manual "Sync now" for an already-listed artwork: one full
 * listing-sync pass (listing meta, Gelato price, Shopify core, price,
 * metafields, inventory, collections, channels). Returns the per-step
 * result so the form can show a summary toast.
 */
export async function syncListingAction(id: string) {
  const artwork = await getArtworkById(id);
  if (!artwork) throw new Error('Artwork not found');
  if (!artwork.shopify_handle) {
    throw new Error('Artwork is not listed yet. Use "Sync and publish" first.');
  }

  const result = await syncArtworkToShopify(id);
  revalidatePath(`/artworks/${id}`);

  const failed = result.steps.filter((s) => !s.ok).map((s) => s.name);
  return {
    ok: failed.length === 0,
    failedSteps: failed,
    warnings: result.warnings,
    stepCount: result.steps.length,
  };
}

/**
 * One-click social draft (carousel or story) from the artwork's mockup
 * set. Inserts a draft `social_posts` row for review in the Content
 * studio; image order follows the ad standard (framed first, plain
 * original only as a substitute zoom) and all text renders through the
 * branded canvas blocks. Never publishes.
 */
export async function createSocialDraftAction(
  id: string,
  kind: SocialDraftKind
): Promise<SocialDraftResult> {
  const artwork = await getArtworkById(id);
  if (!artwork) return { ok: false, message: 'Artwork not found' };

  const result = await createSocialDraft(
    {
      id: artwork.id,
      title: artwork.title,
      price: artwork.price ?? null,
      currency: artwork.currency ?? null,
      product_type: artwork.product_type ?? null,
      shopify_handle: artwork.shopify_handle ?? null,
      creation_source: artwork.creation_source ?? null,
      mockup_urls: (artwork.mockup_urls ?? null) as SocialDraftArtwork['mockup_urls'],
      artistName: artwork.users?.name ?? null,
      inspiration_summary: artwork.inspiration_summary ?? null,
      description: artwork.description ?? null,
    },
    kind
  );

  if (result.ok) revalidatePath('/content');
  return result;
}
