'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { markArtworkAsListedAction } from '@/app/(admin)/artworks/actions';

interface ListingFormProps {
  artworkId: string;
  status: 'created' | 'listed' | 'sold';
  shopifyHandle: string | null;
  shopifyProductId: string | null;
  hasTopic: boolean;
}

/**
 * Surfaces the manual hop in the Gelato → Shopify pipeline.
 *
 * After `pushToGelatoAction` runs, Gelato auto-publishes a Shopify product.
 * No webhook tells the admin when that has happened, so the operator
 * confirms the Shopify product is live, copies its handle (and optionally
 * the product GID), and submits this form. The action then:
 *   1. Stores the Shopify identifiers on the artwork
 *   2. Transitions status to `listed`
 *   3. If the artwork is linked to a topic, writes a `product_topics`
 *      row so the public storefront can surface the topic story.
 */
export function ListingForm({
  artworkId,
  status,
  shopifyHandle,
  shopifyProductId,
  hasTopic,
}: ListingFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (formData: FormData) => {
    setError(null);
    setSubmitting(true);
    try {
      await markArtworkAsListedAction(artworkId, formData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to mark artwork as listed.'
      );
      setSubmitting(false);
    }
  };

  if (status === 'sold') {
    return (
      <Card>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Listing</h3>
          <p className="text-sm text-gray-600">
            This artwork has been sold. Shopify handle:{' '}
            <span className="font-mono text-gray-900">{shopifyHandle ?? '—'}</span>
          </p>
        </div>
      </Card>
    );
  }

  if (status === 'listed' && shopifyHandle) {
    return (
      <Card>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Listing</h3>
          <p className="text-sm text-gray-600">
            Live on Shopify as{' '}
            <span className="font-mono text-gray-900">{shopifyHandle}</span>
            {shopifyProductId && (
              <>
                {' '}
                (
                <span className="font-mono text-xs text-gray-500">
                  {shopifyProductId}
                </span>
                )
              </>
            )}
            .
          </p>
          {hasTopic && (
            <p className="text-xs text-gray-500">
              Topic provenance is wired via <code>product_topics</code>.
            </p>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form action={handleSubmit} className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Mark as Listed</h3>
          <p className="mt-1 text-sm text-gray-500">
            Once Gelato has published this product to Shopify, paste the
            Shopify handle below. This stores it on the artwork, transitions
            the status to <code>listed</code>, and (if a topic is attached)
            writes a <code>product_topics</code> row so the public storefront
            renders the topic story on the product page.
          </p>
        </div>

        <Input
          name="shopify_handle"
          label="Shopify handle"
          placeholder="e.g. risograph-pulse-001"
          required
          helperText="Lowercase, kebab-case identifier from the Shopify product URL."
        />

        <Input
          name="shopify_product_id"
          label="Shopify product GID (optional)"
          placeholder="gid://shopify/Product/1234567890"
          helperText="Find under Shopify admin → product → ⋯ → Get product GID."
        />

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <Button type="submit" disabled={submitting} loading={submitting}>
          Mark as Listed
        </Button>

        {!hasTopic && (
          <p className="text-xs text-amber-700">
            Note: this artwork is not linked to a topic, so the storefront&apos;s
            &quot;Story Behind This Artwork&quot; block will not render. Attach
            a topic in the form above before listing if you want provenance to
            surface.
          </p>
        )}
      </form>
    </Card>
  );
}
