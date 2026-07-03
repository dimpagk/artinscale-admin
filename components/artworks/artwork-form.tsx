'use client';

import { useRef, useState } from 'react';
import { Sparkle, CaretDown } from '@phosphor-icons/react';
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
import { getProductDefaults, getPrintSpec, PRODUCT_DEFAULTS } from '@/lib/pricing-defaults';
import {
  DEFAULT_FINANCE,
  netMarginPct,
  netContributionEur,
  type PricingFinance,
  type SizePriceStat,
  type SizeMixEntry,
} from '@/lib/pricing-math';
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
  /**
   * Fee/VAT config for the margin preview, read from finance_settings on
   * the server (getPricingFinance). Falls back to DEFAULT_FINANCE so the
   * form still renders sensible numbers if it isn't passed.
   */
  finance?: PricingFinance;
  /**
   * Median EUR price of published artworks per product_type, for the
   * "recommended price" hint. Keyed by size key; absent sizes have no
   * published comparables yet.
   */
  sizePriceStats?: Record<string, SizePriceStat>;
  /**
   * Published catalog split by size (pieces + units sold per product_type),
   * for the "size mix" breakdown that helps the operator pick a size. Built
   * server-side by getSizeMix; absent sizes have no published pieces yet.
   */
  sizeMix?: SizeMixEntry[];
}

export function ArtworkForm({
  artwork,
  artists,
  topics,
  finance = DEFAULT_FINANCE,
  sizePriceStats,
  sizeMix,
}: ArtworkFormProps) {
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
  // Controlled so the margin preview can tell classics (size-priced,
  // per-unit contribution only) from originals (also amortise a one-time
  // creation cost) as the operator changes the Source.
  const [creationSource, setCreationSource] = useState<string>(
    artwork?.creation_source || 'ai'
  );

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

  // ─── Product-type lock + margin preview ──────────────────────────
  // Once mockups are composed or the piece is a live Gelato product, its
  // printed size is fixed: changing product_type would desync the mockups
  // / Gelato variant. Lock the control (and carry its value in a hidden
  // input so a disabled <select> doesn't drop product_type on save).
  const hasMockups = !!artwork?.mockup_urls;
  const syncedToGelato = !!artwork?.gelato_product_id;
  const productTypeLocked = hasMockups || syncedToGelato;
  const lockReason =
    hasMockups && syncedToGelato
      ? 'mockups exist and it is synced to Gelato'
      : hasMockups
        ? 'mockups have been composed'
        : 'it is synced to Gelato';

  const printSpec = getPrintSpec(productType);
  const sizeDefaults = getProductDefaults(productType);
  // Prefer the actual Gelato cost stamped on the artwork when we're still
  // on the saved size; a changed size falls back to the size estimate.
  const usingActualCost =
    isEditing &&
    productType === artwork?.product_type &&
    artwork?.unit_production_cost != null;
  const gelatoCost = usingActualCost
    ? Number(artwork!.unit_production_cost)
    : sizeDefaults?.gelatoCostEur ?? null;

  // Price recommendation for this size: the median of published EUR pieces
  // at the same size, falling back to the catalog default when nothing is
  // live yet. Shown with its margin so the operator can price consistently.
  const sizeStat = productType ? sizePriceStats?.[productType] : undefined;
  const recommendedFromPublished = !!sizeStat && sizeStat.count > 0;
  const recommendedRaw = recommendedFromPublished ? sizeStat!.median : sizeDefaults?.price ?? null;
  // Round to a whole euro so the shown price, the applied price, and the
  // "Applied" check all agree (a median of two prices can land on x.5).
  const recommendedPrice = recommendedRaw != null ? Math.round(recommendedRaw) : null;
  const recommendedMarginPct =
    recommendedPrice != null && gelatoCost != null && currency === 'EUR'
      ? netMarginPct(recommendedPrice, gelatoCost, finance)
      : null;

  // Size mix across the published catalog: every catalog size in order,
  // with its published-piece count and units sold, plus each size's share
  // of pieces. Sizes with nothing live yet still show (at 0%) so gaps in
  // the range are visible when picking a size.
  const sizeMixByKey = new Map((sizeMix ?? []).map((r) => [r.sizeKey, r]));
  const sizeMixRows = Object.entries(PRODUCT_DEFAULTS).map(([key, d]) => {
    const r = sizeMixByKey.get(key);
    sizeMixByKey.delete(key);
    return {
      sizeKey: key,
      label: `${d.widthCm}×${d.heightCm} cm`,
      pieces: r?.pieces ?? 0,
      unitsSold: r?.unitsSold ?? 0,
    };
  });
  // Any published size not in the catalog defaults table (retired size key).
  for (const r of sizeMixByKey.values()) {
    sizeMixRows.push({ sizeKey: r.sizeKey, label: r.sizeKey, pieces: r.pieces, unitsSold: r.unitsSold });
  }
  const sizeMixTotalPieces = sizeMixRows.reduce((s, r) => s + r.pieces, 0);
  const sizeMixTotalSold = sizeMixRows.reduce((s, r) => s + r.unitsSold, 0);

  const parsedPrice = parseFloat(priceOverride);
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0;
  // Margin math is EUR-based (Gelato cost, VAT, fees). Only show it when
  // the sell price is priced in EUR too.
  const marginComputable = priceValid && gelatoCost != null && currency === 'EUR';
  const floorPct = marginComputable ? netMarginPct(parsedPrice, gelatoCost, finance) : null;
  const floorEur = marginComputable ? netContributionEur(parsedPrice, gelatoCost, finance) : null;
  const ceilingEur = marginComputable
    ? netContributionEur(parsedPrice, gelatoCost, { ...finance, vatPercent: 0 })
    : null;

  // Classics (public domain / purchased) are priced per size; originals
  // (AI / community / manual) also carry a one-time creation cost that
  // amortises across units sold.
  const isClassic = creationSource === 'public_domain' || creationSource === 'purchased';
  const creationCost = artwork?.creation_cost != null ? Number(artwork.creation_cost) : null;
  const unitsSold = artwork?.edition_sold ?? 0;
  const amortizedCreation =
    creationCost != null && creationCost > 0 && unitsSold > 0 ? creationCost / unitsSold : null;
  // Net-of-creation contribution: what each sale nets once its share of the
  // one-time creation cost is subtracted (only meaningful once units sell).
  const netOfCreationEur =
    floorEur != null && amortizedCreation != null ? floorEur - amortizedCreation : null;

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
                disabled={productTypeLocked}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleProductTypeChange(e.target.value)}
                helperText={
                  productTypeLocked
                    ? `Size locked because ${lockReason}. Changing it would desync the printed product.`
                    : undefined
                }
              />
              {/* A disabled <select> is dropped from FormData; keep the
                  value in the payload so save doesn't clear product_type. */}
              {productTypeLocked && (
                <input type="hidden" name="product_type" value={productType} />
              )}
            </div>
          </FormGrid>

          {sizeMixTotalPieces > 0 && (
            <details className="group mt-4 rounded-lg border border-gray-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-medium text-gray-900">Size mix (published catalog)</span>
                <span className="flex items-center gap-2 text-xs text-gray-500">
                  {sizeMixTotalPieces} piece{sizeMixTotalPieces === 1 ? '' : 's'} · {sizeMixTotalSold} sold
                  <CaretDown
                    size={14}
                    className="text-gray-400 transition-transform duration-200 group-open:rotate-180"
                  />
                </span>
              </summary>
              <div className="space-y-2.5 border-t border-gray-100 px-4 py-3">
                {sizeMixRows.map((r) => {
                  const pct = sizeMixTotalPieces > 0 ? (r.pieces / sizeMixTotalPieces) * 100 : 0;
                  const isCurrent = r.sizeKey === productType;
                  return (
                    <div key={r.sizeKey}>
                      <div className="flex items-center justify-between text-xs">
                        <span className={isCurrent ? 'font-semibold text-gray-900' : 'text-gray-700'}>
                          {r.label}
                          {isCurrent && (
                            <span className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium text-violet-700">
                              current
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums text-gray-500">
                          <span className={isCurrent ? 'font-medium text-gray-900' : 'text-gray-700'}>
                            {pct.toFixed(0)}%
                          </span>{' '}
                          <span className="text-gray-400">
                            · {r.pieces} live · {r.unitsSold} sold
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${isCurrent ? 'bg-violet-500' : 'bg-gray-300'}`}
                          style={{ width: `${Math.max(pct, r.pieces > 0 ? 3 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="pt-1 text-[11px] text-gray-400">
                  Share of published (listed + sold) pieces per size; sold counts units across those
                  pieces. Empty sizes show gaps in the range you could fill.
                </p>
              </div>
            </details>
          )}

          {productType ? (
            <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              {printSpec && (
                <p className="text-xs text-gray-600">
                  <span className="font-medium text-gray-900">
                    {printSpec.widthCm} × {printSpec.heightCm} cm
                  </span>{' '}
                  · prints at 300 DPI · needs a master of at least{' '}
                  {printSpec.minPxWidth.toLocaleString()} × {printSpec.minPxHeight.toLocaleString()} px.
                  Smaller sources are upscaled before print.
                </p>
              )}

              {recommendedPrice != null && currency === 'EUR' && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                  <div className="text-xs text-gray-600">
                    <span className="text-gray-900">
                      Recommended{' '}
                      <span className="font-semibold">€{recommendedPrice.toFixed(0)}</span>
                      {recommendedMarginPct != null && (
                        <> · {recommendedMarginPct.toFixed(0)}% margin</>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-gray-400">
                      {recommendedFromPublished
                        ? `median of ${sizeStat!.count} published ${printSpec ? `${printSpec.widthCm}×${printSpec.heightCm}` : ''} piece${sizeStat!.count === 1 ? '' : 's'}${
                            sizeStat!.min !== sizeStat!.max
                              ? ` (€${sizeStat!.min.toFixed(0)}–€${sizeStat!.max.toFixed(0)})`
                              : ''
                          }`
                        : 'catalog default — no published pieces at this size yet'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPriceOverride(String(recommendedPrice))}
                    className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    {priceValid && Math.abs(parsedPrice - recommendedPrice) < 0.005 ? 'Applied' : 'Use'}
                  </button>
                </div>
              )}

              {marginComputable && floorPct != null ? (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-gray-900">
                      Margin {floorPct.toFixed(0)}%
                    </span>
                    <span className="text-sm text-gray-600">
                      €{(floorEur ?? 0).toFixed(2)} / unit
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                    <dt>Sell price (incl. VAT)</dt>
                    <dd className="text-right text-gray-900">€{parsedPrice.toFixed(2)}</dd>
                    <dt>
                      Production cost{' '}
                      <span className="text-gray-400">({usingActualCost ? 'actual' : 'est'})</span>
                    </dt>
                    <dd className="text-right text-gray-900">−€{(gelatoCost ?? 0).toFixed(2)}</dd>
                    {finance.vatPercent > 0 && (
                      <>
                        <dt>Contribution (export, 0% VAT)</dt>
                        <dd className="text-right text-gray-900">€{(ceilingEur ?? 0).toFixed(2)}</dd>
                      </>
                    )}
                    {!isClassic && creationCost != null && creationCost > 0 && (
                      <>
                        <dt>Creation cost (one-time)</dt>
                        <dd className="text-right text-gray-900">€{creationCost.toFixed(2)}</dd>
                        {amortizedCreation != null ? (
                          <>
                            <dt>Amortised / unit ({unitsSold} sold)</dt>
                            <dd className="text-right text-gray-900">−€{amortizedCreation.toFixed(2)}</dd>
                            <dt className="font-medium text-gray-700">Net after creation</dt>
                            <dd className="text-right font-medium text-gray-900">
                              €{(netOfCreationEur ?? 0).toFixed(2)}
                            </dd>
                          </>
                        ) : (
                          <>
                            <dt className="col-span-2 text-gray-400">
                              Amortises once units sell; recouped after ~
                              {floorEur && floorEur > 0 ? Math.ceil(creationCost / floorEur) : '—'} sales.
                            </dt>
                          </>
                        )}
                      </>
                    )}
                  </dl>
                  <p className="text-[11px] text-gray-400">
                    Contribution at the {finance.vatPercent}% VAT floor,{' '}
                    {finance.paymentFeePercent}% + €{finance.paymentFeeFixed.toFixed(2)} payment fee
                    {finance.source === 'finance_settings' ? ' (from finance settings)' : ' (defaults)'}.
                    VAT is a pass-through.
                    {isClassic ? ' Classic: priced per size.' : ' Original: creation cost amortises across the edition.'}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  {gelatoCost == null
                    ? 'No production-cost estimate for this size yet.'
                    : currency !== 'EUR'
                      ? 'Margin preview is available for EUR pricing.'
                      : 'Enter a price to preview the margin.'}
                </p>
              )}
            </div>
          ) : null}
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
              value={creationSource}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCreationSource(e.target.value)}
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
              Gelato product created. The listing finalizes automatically once Gelato publishes to Shopify (the finalize cron runs every ~15 min). To list it now, use Mark as Listed once the Shopify product appears.
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
