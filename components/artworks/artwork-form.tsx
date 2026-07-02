'use client';

import { useRef, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  FormActions,
  FormCard,
  FormGrid,
  DeleteConfirmModal,
  IntegrationStatusCard,
} from '@/components/admin-ui';
import { ArtworkPipelineActivity } from '@/components/artworks/artwork-pipeline-activity';
import { MockupGallery } from '@/components/artworks/mockup-gallery';
import type { Artwork } from '@/lib/types';
import { getProductDefaults } from '@/lib/pricing-defaults';
import {
  createArtworkAction,
  updateArtworkAction,
  deleteArtworkAction,
  pushToGelatoAction,
  regenerateListingMetaAction,
  draftArtworkFieldsAction,
  syncListingAction,
} from '@/app/(admin)/artworks/actions';
import { EMPTY_LISTING_META, type ListingMeta } from '@/lib/types';

interface ArtworkFormProps {
  artwork?: Artwork;
  artists: { id: string; name: string }[];
  topics: { id: string; title: string }[];
}

export function ArtworkForm({ artwork, artists, topics }: ArtworkFormProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [gelatoPushing, setGelatoPushing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const isEditing = !!artwork;

  // Smart prefill — only on create. When the operator picks a
  // product_type and price/edition are still empty, auto-fill from the
  // PRODUCT_DEFAULTS table. We track the value as state so prefill
  // triggers re-render of the price + edition inputs.
  const [productType, setProductType] = useState<string>(artwork?.product_type || '');
  const [priceOverride, setPriceOverride] = useState<string>(
    artwork?.price != null ? String(artwork.price) : ''
  );
  const [editionOverride, setEditionOverride] = useState<string>(
    artwork?.edition_size != null ? String(artwork.edition_size) : ''
  );

  // Controlled so "Generate all fields" can fill them as suggestions.
  const [title, setTitle] = useState<string>(artwork?.title || '');
  const [description, setDescription] = useState<string>(artwork?.description || '');
  const [currency, setCurrency] = useState<string>(artwork?.currency || 'EUR');

  // Listing meta state — controlled inputs so the Regenerate button
  // can update them without a page reload.
  const initialMeta: ListingMeta = artwork?.listing_meta ?? EMPTY_LISTING_META;
  const [listingMeta, setListingMeta] = useState<ListingMeta>(initialMeta);

  // "Generate all fields" review state: which fields currently hold a
  // fresh suggestion (drives the highlight), plus a snapshot of the
  // pre-draft values so Discard can restore them. Nothing persists
  // until the operator hits Save.
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const preDraftRef = useRef<{
    title: string;
    description: string;
    productType: string;
    priceOverride: string;
    editionOverride: string;
    currency: string;
    listingMeta: ListingMeta;
  } | null>(null);

  // "Sync now" (already-listed artworks) result summary.
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleProductTypeChange = (next: string) => {
    setProductType(next);
    if (isEditing) return;
    const defaults = getProductDefaults(next);
    if (!defaults) return;
    // Price prefills from the product type, but edition stays empty: new
    // pieces default to an open (unlimited) edition; the operator sets a
    // limit only when they want one.
    if (!priceOverride) setPriceOverride(String(defaults.price));
  };

  const handleRegenerateListingMeta = async () => {
    if (!artwork) return;
    setRegenerating(true);
    try {
      const next = await regenerateListingMetaAction(artwork.id);
      setListingMeta(next);
    } catch (err) {
      console.error('Failed to regenerate listing meta:', err);
    } finally {
      setRegenerating(false);
    }
  };

  /**
   * Draft every listing field for review. Fills the form with the
   * suggestions, highlights what changed, and snapshots the previous
   * values so Discard can restore them. Save is the only thing that
   * persists.
   */
  const handleGenerateAllFields = async () => {
    if (!artwork) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const draft = await draftArtworkFieldsAction(artwork.id);
      const s = draft.suggestions;
      preDraftRef.current = {
        title,
        description,
        productType,
        priceOverride,
        editionOverride,
        currency,
        listingMeta,
      };
      const changed = new Set<string>();
      if (s.title && s.title !== title) {
        setTitle(s.title);
        changed.add('title');
      }
      if (s.description && s.description !== description) {
        setDescription(s.description);
        changed.add('description');
      }
      if (s.productType && s.productType !== productType) {
        setProductType(s.productType);
        changed.add('product_type');
      }
      if (s.price != null && String(s.price) !== priceOverride) {
        setPriceOverride(String(s.price));
        changed.add('price');
      }
      if (s.editionSize != null && String(s.editionSize) !== editionOverride) {
        setEditionOverride(String(s.editionSize));
        changed.add('edition_size');
      }
      if (s.currency && s.currency !== currency) {
        setCurrency(s.currency);
        changed.add('currency');
      }
      const metaKeys = ['seoTitle', 'seoDescription', 'ogTitle', 'ogDescription'] as const;
      const nextMeta: ListingMeta = { ...listingMeta };
      let metaChanged = false;
      for (const key of metaKeys) {
        const value = s[key];
        if (value && value !== listingMeta[key]) {
          nextMeta[key] = value;
          metaChanged = true;
          changed.add(key);
        }
      }
      if (metaChanged) setListingMeta(nextMeta);
      setSuggested(changed);
      if (changed.size === 0) {
        setDraftError('Everything already matches the draft. No changes suggested.');
      }
    } catch (err) {
      console.error('Failed to draft artwork fields:', err);
      setDraftError(err instanceof Error ? err.message : 'Draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const handleDiscardSuggestions = () => {
    const prev = preDraftRef.current;
    if (!prev) return;
    setTitle(prev.title);
    setDescription(prev.description);
    setProductType(prev.productType);
    setPriceOverride(prev.priceOverride);
    setEditionOverride(prev.editionOverride);
    setCurrency(prev.currency);
    setListingMeta(prev.listingMeta);
    setSuggested(new Set());
    preDraftRef.current = null;
  };

  /** Highlight wrapper class for fields holding a fresh suggestion. */
  const sug = (key: string): string | undefined =>
    suggested.has(key)
      ? 'rounded-lg p-2 -m-2 ring-2 ring-violet-300 bg-violet-50/50'
      : undefined;

  /** Full listing-sync pass for already-listed artworks. */
  const handleSyncNow = async () => {
    if (!artwork) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncListingAction(artwork.id);
      setSyncMessage(
        result.ok
          ? `Synced ${result.stepCount} steps to Gelato + Shopify.`
          : `Sync finished with issues: ${result.failedSteps.join(', ')}`
      );
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // "Sync and publish" needs these before it can create the product.
  const missingForPublish: string[] = [];
  if (!title.trim()) missingForPublish.push('title');
  if (!artwork?.image_url) missingForPublish.push('image');
  if (!priceOverride) missingForPublish.push('price');

  const artistOptions = [
    { value: '', label: 'No artist assigned' },
    ...artists.map((a) => ({ value: a.id, label: a.name })),
  ];

  const topicOptions = [
    { value: '', label: 'No topic assigned' },
    ...topics.map((t) => ({ value: t.id, label: t.title })),
  ];

  const handleSubmit = async (formData: FormData) => {
    if (isEditing) {
      await updateArtworkAction(artwork.id, formData);
    } else {
      await createArtworkAction(formData);
    }
  };

  const handleDelete = async () => {
    if (artwork) {
      await deleteArtworkAction(artwork.id);
    }
  };

  const handlePushToGelato = async () => {
    if (!artwork) return;
    setGelatoPushing(true);
    try {
      await pushToGelatoAction(artwork.id);
    } catch (err) {
      console.error('Failed to push to Gelato:', err);
    } finally {
      setGelatoPushing(false);
    }
  };

  return (
    <>
      <form action={handleSubmit} className="space-y-6">
        {isEditing && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {suggested.size > 0
                  ? `${suggested.size} suggestion${suggested.size === 1 ? '' : 's'} filled in - review the highlighted fields, then Save.`
                  : 'Generate all fields'}
              </p>
              <p className="text-xs text-gray-600">
                Drafts title, description, size, price, edition and SEO copy for review. Nothing is saved until you hit Save.
              </p>
              {draftError && <p className="mt-1 text-xs text-red-600">{draftError}</p>}
            </div>
            <div className="flex items-center gap-2">
              {suggested.size > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={handleDiscardSuggestions}>
                  Discard suggestions
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleGenerateAllFields}
                loading={drafting}
                disabled={drafting}
                icon={<Sparkle size={14} />}
              >
                {suggested.size > 0 ? 'Regenerate' : 'Generate all fields'}
              </Button>
            </div>
          </div>
        )}

        <FormCard title="Identity">
          <div className={sug('title')}>
            <Input
              name="title"
              label="Title"
              value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className={sug('description')}>
            <Textarea
              name="description"
              label="Description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <Input
            name="image_url"
            label="Image URL"
            defaultValue={artwork?.image_url || ''}
            helperText="URL to the artwork image"
          />

          <FormGrid columns={2}>
            <Select
              name="artist_id"
              label="Artist"
              options={artistOptions}
              defaultValue={artwork?.artist_id || ''}
            />

            <Select
              name="topic_id"
              label="Topic"
              options={topicOptions}
              defaultValue={artwork?.topic_id || ''}
            />
          </FormGrid>
        </FormCard>

        <FormCard title="Edition & status">
          <FormGrid columns={3}>
            <Select
              name="status"
              label="Status"
              options={[
                { value: 'created', label: 'Created' },
                { value: 'listed', label: 'Listed' },
                { value: 'sold', label: 'Sold' },
                { value: 'retired', label: 'Retired' },
              ]}
              defaultValue={artwork?.status || 'created'}
            />

            <div className={sug('edition_size')}>
              <Input
                name="edition_size"
                label="Edition Size"
                type="number"
                value={editionOverride}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditionOverride(e.target.value)}
                helperText="Empty = open edition (the default). Enter a number to make it limited."
              />
            </div>

            <Input
              name="edition_sold"
              label="Edition Sold"
              type="number"
              defaultValue={artwork?.edition_sold ?? 0}
            />
          </FormGrid>
        </FormCard>

        <FormCard title="Pricing & product">
          <FormGrid columns={3}>
            <div className={sug('price')}>
              <Input
                name="price"
                label="Price"
                type="number"
                step="0.01"
                value={priceOverride}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPriceOverride(e.target.value)}
                helperText={isEditing ? undefined : 'Auto-prefills from product type; you can override.'}
              />
            </div>

            <div className={sug('currency')}>
              <Select
                name="currency"
                label="Currency"
                options={[
                  { value: 'EUR', label: 'EUR' },
                  { value: 'USD', label: 'USD' },
                  { value: 'GBP', label: 'GBP' },
                ]}
                value={currency}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCurrency(e.target.value)}
              />
            </div>

            <div className={sug('product_type')}>
              <Select
                name="product_type"
                label="Product Type"
                options={[
                  { value: '', label: 'None' },
                  { value: 'museum-poster-21x30', label: 'Museum Poster · 21×30 cm (gallery / desk)' },
                  { value: 'museum-poster-30x40', label: 'Museum Poster · 30×40 cm (bedroom flank / desk)' },
                  { value: 'museum-poster-30x45', label: 'Museum Poster · 30×45 cm (corridor end-cap)' },
                  { value: 'museum-poster-40x50', label: 'Museum Poster · 40×50 cm (office / dining single)' },
                  { value: 'museum-poster-50x70', label: 'Museum Poster · 50×70 cm (above-bed centerpiece)' },
                  { value: 'museum-poster-60x90', label: 'Museum Poster · 60×90 cm (sofa pair / dining)' },
                  { value: 'museum-poster-70x100', label: 'Museum Poster · 70×100 cm (statement above sofa)' },
                ]}
                value={productType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleProductTypeChange(e.target.value)}
              />
            </div>
          </FormGrid>
        </FormCard>

        <FormCard
          title="Creation cost"
          description="One-time cost to make this piece — the basis for unit economics. It's distributed across every unit sold, so it falls the more the piece sells."
        >
          <FormGrid columns={2}>
            <Select
              name="creation_source"
              label="Source"
              options={[
                { value: 'ai', label: 'AI-generated' },
                { value: 'community', label: 'Community artist' },
                { value: 'purchased', label: 'Purchased / licensed' },
                { value: 'public_domain', label: 'Public domain' },
                { value: 'manual', label: 'Other / manual' },
              ]}
              defaultValue={artwork?.creation_source || 'ai'}
              helperText="Auto-set from the assigned artist's kind on save."
            />
            <Input
              name="creation_cost"
              label={`Creation cost (${artwork?.creation_cost_currency || 'EUR'})`}
              type="number"
              step="0.01"
              defaultValue={artwork?.creation_cost != null ? String(artwork.creation_cost) : ''}
              helperText={
                isEditing
                  ? 'Leave as-is to keep. Community = the flat fee you pay the artist.'
                  : 'Blank auto-fills: AI estimates from the ledger, community uses the default flat fee.'
              }
            />
          </FormGrid>
        </FormCard>

        <FormCard
          title="Provenance"
          description="Surfaces on the public storefront under 'The Story Behind This Artwork' alongside the linked topic and contributions."
        >
          <Textarea
            name="inspiration_summary"
            label="Inspiration Summary"
            defaultValue={artwork?.inspiration_summary || ''}
            rows={4}
          />
        </FormCard>

        {isEditing && (
          <FormCard
            title="Listing copy"
            description={
              listingMeta.generatedBy === 'manual'
                ? `Manually edited${listingMeta.generatedAt ? ` ${new Date(listingMeta.generatedAt).toLocaleString()}` : ''}. Auto-regen is paused until you click Regenerate.`
                : listingMeta.generatedBy === 'agent'
                  ? `Generated by listing-generator${listingMeta.generatedAt ? ` ${new Date(listingMeta.generatedAt).toLocaleString()}` : ''}. Editing flips to manual.`
                  : 'Empty — saving with values flips to manual; Regenerate fills via the agent.'
            }
          >
            <div className={sug('seoTitle')}>
              <Input
                name="listing_meta_seo_title"
                label="SEO Title"
                value={listingMeta.seoTitle ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setListingMeta({ ...listingMeta, seoTitle: e.target.value || null })
                }
                helperText="≤60 chars · drives <title> and SERP listing"
                maxLength={60}
              />
            </div>
            <div className={sug('seoDescription')}>
              <Textarea
                name="listing_meta_seo_description"
                label="SEO Description"
                value={listingMeta.seoDescription ?? ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setListingMeta({ ...listingMeta, seoDescription: e.target.value || null })
                }
                rows={2}
                helperText="≤160 chars · search snippet"
                maxLength={160}
              />
            </div>
            <div className={sug('ogTitle')}>
              <Input
                name="listing_meta_og_title"
                label="OG Title (social share)"
                value={listingMeta.ogTitle ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setListingMeta({ ...listingMeta, ogTitle: e.target.value || null })
                }
                helperText="≤60 chars · what shows on Twitter / FB / LinkedIn share"
                maxLength={60}
              />
            </div>
            <div className={sug('ogDescription')}>
              <Textarea
                name="listing_meta_og_description"
                label="OG Description (social share)"
                value={listingMeta.ogDescription ?? ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setListingMeta({ ...listingMeta, ogDescription: e.target.value || null })
                }
                rows={2}
                helperText="≤200 chars · stop-the-scroll copy"
                maxLength={200}
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRegenerateListingMeta}
                loading={regenerating}
                disabled={regenerating}
              >
                Regenerate via agent
              </Button>
              <span className="text-xs text-zinc-500">
                Forces a fresh generation, overwrites manual edits.
              </span>
            </div>
          </FormCard>
        )}

        <FormActions
          submitLabel={isEditing ? 'Save Changes' : 'Create Artwork'}
          cancelHref="/artworks"
          onDelete={isEditing ? () => setShowDeleteModal(true) : undefined}
          deleteLabel="Delete"
        />
      </form>

      {isEditing && (
        <FormCard
          className="mt-6"
          title="Integrations"
          description="One button covers the whole pipeline: Gelato product, Shopify auto-publish, listing sync and product photos. Progress shows in pipeline activity below."
        >
          <IntegrationStatusCard
            name="Gelato"
            synced={!!artwork.gelato_product_id}
            identifierLabel="Product ID"
            identifierValue={artwork.gelato_product_id}
            action={
              !artwork.gelato_product_id ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handlePushToGelato}
                  loading={gelatoPushing}
                  disabled={gelatoPushing || missingForPublish.length > 0}
                  title={
                    missingForPublish.length > 0
                      ? `Missing: ${missingForPublish.join(', ')}`
                      : undefined
                  }
                >
                  Sync and publish
                </Button>
              ) : undefined
            }
          />
          {!artwork.gelato_product_id && missingForPublish.length > 0 && (
            <p className="text-xs text-gray-500">
              Needs {missingForPublish.join(', ')} before it can publish. Save first if you just filled them in.
            </p>
          )}
          {!!artwork.gelato_product_id && !artwork.shopify_handle && (
            <p className="text-xs text-gray-500">
              Gelato product created. Shopify auto-publish usually lands within a minute; if it does not, paste the handle in Mark as Listed.
            </p>
          )}

          <IntegrationStatusCard
            name="Shopify"
            synced={!!artwork.shopify_handle}
            identifierLabel="Handle"
            identifierValue={artwork.shopify_handle}
            action={
              artwork.shopify_handle ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleSyncNow}
                  loading={syncing}
                  disabled={syncing}
                >
                  Sync now
                </Button>
              ) : undefined
            }
          />
          {syncMessage && <p className="text-xs text-gray-600">{syncMessage}</p>}
        </FormCard>
      )}

      {isEditing && (
        <MockupGallery
          artworkId={artwork.id}
          initialMockups={artwork.mockup_urls ?? null}
          shopifyHandle={artwork.shopify_handle}
        />
      )}

      {isEditing && <ArtworkPipelineActivity artworkId={artwork.id} />}

      {isEditing && (
        <DeleteConfirmModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          entity="Artwork"
          itemName={artwork.title}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}
