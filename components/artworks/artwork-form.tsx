'use client';

import { useState } from 'react';
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
import type { Artwork } from '@/lib/types';
import { getProductDefaults } from '@/lib/pricing-defaults';
import {
  createArtworkAction,
  updateArtworkAction,
  deleteArtworkAction,
  pushToGelatoAction,
  regenerateListingMetaAction,
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

  // Listing meta state — controlled inputs so the Regenerate button
  // can update them without a page reload.
  const initialMeta: ListingMeta = artwork?.listing_meta ?? EMPTY_LISTING_META;
  const [listingMeta, setListingMeta] = useState<ListingMeta>(initialMeta);

  const handleProductTypeChange = (next: string) => {
    setProductType(next);
    if (isEditing) return;
    const defaults = getProductDefaults(next);
    if (!defaults) return;
    if (!priceOverride) setPriceOverride(String(defaults.price));
    if (!editionOverride) setEditionOverride(String(defaults.editionSize));
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
        <FormCard title="Identity">
          <Input
            name="title"
            label="Title"
            defaultValue={artwork?.title}
            required
          />

          <Textarea
            name="description"
            label="Description"
            defaultValue={artwork?.description || ''}
            rows={3}
          />

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

            <Input
              name="edition_size"
              label="Edition Size"
              type="number"
              value={editionOverride}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditionOverride(e.target.value)}
              helperText="Empty = open edition. Auto-prefills from product type on create; you can override."
            />

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
            <Input
              name="price"
              label="Price"
              type="number"
              step="0.01"
              value={priceOverride}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPriceOverride(e.target.value)}
              helperText={isEditing ? undefined : 'Auto-prefills from product type; you can override.'}
            />

            <Select
              name="currency"
              label="Currency"
              options={[
                { value: 'EUR', label: 'EUR' },
                { value: 'USD', label: 'USD' },
                { value: 'GBP', label: 'GBP' },
              ]}
              defaultValue={artwork?.currency || 'EUR'}
            />

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
                { value: 'purchased', label: 'Purchased / licensed' },
                { value: 'public_domain', label: 'Public domain' },
                { value: 'manual', label: 'Other / manual' },
              ]}
              defaultValue={artwork?.creation_source || 'ai'}
            />
            <Input
              name="creation_cost"
              label={`Creation cost (${artwork?.creation_cost_currency || 'EUR'})`}
              type="number"
              step="0.01"
              defaultValue={artwork?.creation_cost != null ? String(artwork.creation_cost) : ''}
              helperText={
                isEditing
                  ? 'Leave as-is to keep. For bought pieces, enter the purchase price.'
                  : 'Leave blank for AI pieces to auto-estimate from the generation ledger.'
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
          description="Sync this artwork to external print and storefront systems."
        >
          <IntegrationStatusCard
            name="Gelato"
            synced={!!artwork.gelato_product_id}
            identifierLabel="Product ID"
            identifierValue={artwork.gelato_product_id}
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handlePushToGelato}
                loading={gelatoPushing}
                disabled={gelatoPushing}
              >
                Push to Gelato
              </Button>
            }
          />

          <IntegrationStatusCard
            name="Shopify"
            synced={!!artwork.shopify_handle}
            identifierLabel="Handle"
            identifierValue={artwork.shopify_handle}
          />
        </FormCard>
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
