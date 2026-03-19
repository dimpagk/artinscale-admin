'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Artwork } from '@/lib/types';
import {
  createArtworkAction,
  updateArtworkAction,
  deleteArtworkAction,
  pushToGelatoAction,
} from '@/app/(admin)/artworks/actions';

interface ArtworkFormProps {
  artwork?: Artwork;
  artists: { id: string; name: string }[];
  topics: { id: string; title: string }[];
}

export function ArtworkForm({ artwork, artists, topics }: ArtworkFormProps) {
  const router = useRouter();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [gelatoPushing, setGelatoPushing] = useState(false);
  const isEditing = !!artwork;

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
      <form action={handleSubmit} className="max-w-2xl space-y-6">
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

        <div className="grid grid-cols-2 gap-4">
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
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Select
            name="status"
            label="Status"
            options={[
              { value: 'created', label: 'Created' },
              { value: 'listed', label: 'Listed' },
              { value: 'sold', label: 'Sold' },
            ]}
            defaultValue={artwork?.status || 'created'}
          />

          <Input
            name="edition_size"
            label="Edition Size"
            type="number"
            defaultValue={artwork?.edition_size ?? ''}
            helperText="Leave empty for open edition"
          />

          <Input
            name="edition_sold"
            label="Edition Sold"
            type="number"
            defaultValue={artwork?.edition_sold ?? 0}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Input
            name="price"
            label="Price"
            type="number"
            step="0.01"
            defaultValue={artwork?.price ?? ''}
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
              { value: 'poster', label: 'Poster' },
              { value: 'canvas', label: 'Canvas' },
              { value: 'framed-poster', label: 'Framed Poster' },
              { value: 'acrylic-print', label: 'Acrylic Print' },
              { value: 'metal-print', label: 'Metal Print' },
            ]}
            defaultValue={artwork?.product_type || ''}
          />
        </div>

        <Textarea
          name="inspiration_summary"
          label="Inspiration Summary"
          defaultValue={artwork?.inspiration_summary || ''}
          rows={4}
        />

        <div className="flex items-center gap-3 pt-4">
          <Button type="submit">{isEditing ? 'Save Changes' : 'Create Artwork'}</Button>
          <Button type="button" variant="ghost" onClick={() => router.push('/artworks')}>
            Cancel
          </Button>
          {isEditing && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setShowDeleteModal(true)}
              className="ml-auto"
            >
              Delete
            </Button>
          )}
        </div>
      </form>

      {isEditing && (
        <div className="mt-8 max-w-2xl space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Integrations</h2>

          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Gelato</p>
                {artwork.gelato_product_id ? (
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="success" size="sm">Synced</Badge>
                    <span className="text-xs text-gray-500">
                      Product ID: {artwork.gelato_product_id}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-gray-500">Not synced</p>
                )}
              </div>
              {!artwork.gelato_product_id && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handlePushToGelato}
                  disabled={gelatoPushing}
                >
                  {gelatoPushing ? 'Pushing...' : 'Push to Gelato'}
                </Button>
              )}
            </div>
          </Card>

          <Card>
            <div>
              <p className="font-medium text-gray-900">Shopify</p>
              {artwork.shopify_handle ? (
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="success" size="sm">Synced</Badge>
                  <span className="text-xs text-gray-500">
                    Handle: {artwork.shopify_handle}
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-gray-500">Not synced</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {isEditing && (
        <Modal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Delete Artwork"
          actions={
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDelete}>
                Delete Artwork
              </Button>
            </div>
          }
        >
          <p className="text-sm text-gray-600">
            Are you sure you want to delete <strong>{artwork.title}</strong>? This action cannot be
            undone.
          </p>
        </Modal>
      )}
    </>
  );
}
