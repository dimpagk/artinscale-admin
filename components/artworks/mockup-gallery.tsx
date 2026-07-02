'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormCard } from '@/components/admin-ui';
import type { MockupUrls } from '@/lib/types';

interface MockupGalleryProps {
  artworkId: string;
  initialMockups: MockupUrls | null;
  shopifyHandle: string | null;
}

/**
 * Product-photo set for an artwork: original, framed close-up, in-room
 * shot, and two focal detail crops.
 *
 * "Generate mockups" fires the existing compose-mockups route (a
 * background agent task, ~1-2 min, ~$0.09); this card then polls the
 * route's GET until the composed set lands on artworks.mockup_urls.
 * Compose progress also shows in the pipeline-activity card below.
 * "Push images to Shopify" replaces the product gallery with the set
 * in display order (only available once the artwork is listed).
 */
export function MockupGallery({ artworkId, initialMockups, shopifyHandle }: MockupGalleryProps) {
  const [mockups, setMockups] = useState<MockupUrls | null>(initialMockups);
  const [composing, setComposing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    const deadline = Date.now() + 3 * 60 * 1000;
    pollRef.current = setInterval(async () => {
      if (Date.now() > deadline) {
        stopPolling();
        setComposing(false);
        setMessage('Compose is taking longer than expected. Check pipeline activity below.');
        return;
      }
      try {
        const res = await fetch(`/api/artworks/${artworkId}/compose-mockups`);
        if (!res.ok) return;
        const data = (await res.json()) as { mockup_urls: MockupUrls | null };
        const composedAt = data.mockup_urls?.composedAt ?? null;
        if (data.mockup_urls && composedAt && composedAt !== startedAtRef.current) {
          setMockups(data.mockup_urls);
          setComposing(false);
          setMessage(null);
          stopPolling();
        }
      } catch {
        // transient poll failure, keep trying until the deadline
      }
    }, 5000);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleCompose = async () => {
    setComposing(true);
    setMessage(null);
    startedAtRef.current = mockups?.composedAt ?? null;
    try {
      const res = await fetch(`/api/artworks/${artworkId}/compose-mockups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: !!mockups }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Compose failed (${res.status})`);
      startPolling();
    } catch (err) {
      setComposing(false);
      setMessage(err instanceof Error ? err.message : 'Compose failed');
    }
  };

  const handlePushToShopify = async () => {
    setPushing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/agents/run/mockup_publisher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artworkId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        data?: { uploaded?: number };
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Push failed (${res.status})`);
      }
      setMessage(
        data.data?.uploaded != null
          ? `Pushed ${data.data.uploaded} images to the Shopify gallery.`
          : 'Pushed images to the Shopify gallery.'
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  const shots: Array<{ url: string; label: string }> = mockups
    ? [
        { url: mockups.original, label: 'Original' },
        { url: mockups.framed, label: 'Framed' },
        { url: mockups.inRoom, label: 'In room' },
        ...mockups.details.map((url, i) => ({ url, label: `Zoom ${i + 1}` })),
      ]
    : [];

  return (
    <FormCard
      className="mt-6"
      title="Product photos"
      description="The composed 5-shot set: original, framed close-up (oak), in-room at true size, and two focal zooms. Generated once, then pushed to the Shopify gallery in display order."
    >
      {shots.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {shots.map((shot) => (
            <a
              key={shot.label}
              href={shot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group"
              title={`Open ${shot.label} full size`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shot.url}
                alt={shot.label}
                className="h-28 w-28 rounded-md border border-gray-200 object-cover transition group-hover:border-gray-400"
              />
              <p className="mt-1 text-center text-xs text-gray-500">{shot.label}</p>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          {composing
            ? 'Composing the photo set (about 1-2 minutes)...'
            : 'No product photos yet. Generate the set to preview it here before publishing.'}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleCompose}
          loading={composing}
          disabled={composing}
        >
          {mockups ? 'Regenerate mockups' : 'Generate mockups'}
        </Button>
        {shopifyHandle && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePushToShopify}
            loading={pushing}
            disabled={pushing || !mockups}
          >
            Push images to Shopify
          </Button>
        )}
        {mockups?.composedAt && (
          <span className="text-xs text-gray-400">
            Composed {new Date(mockups.composedAt).toLocaleString()}
          </span>
        )}
      </div>
      {message && <p className="mt-2 text-xs text-gray-600">{message}</p>}
    </FormCard>
  );
}
