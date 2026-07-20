'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * One lazily rendered frame of a generative system. Asks the render API for
 * the seed (content-addressed cached server-side), shows a quiet paper-toned
 * placeholder while the renderer works.
 */
export function SeedImage({
  system,
  seed,
  kind,
  params,
  className,
  alt,
}: {
  system: string;
  seed: number;
  kind: 'thumb' | 'preview';
  params?: Record<string, string | number>;
  className?: string;
  alt?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One request key per (seed, params) combination; stale responses are
  // ignored so rapid param changes never paint an older frame on top.
  const requestKey = JSON.stringify({ system, seed, kind, params: params ?? {} });
  const latest = useRef(requestKey);

  useEffect(() => {
    latest.current = requestKey;
    setUrl(null);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/generative/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system, seed, kind, params }),
        });
        const data = await res.json();
        if (cancelled || latest.current !== requestKey) return;
        if (!res.ok) throw new Error(data.error ?? `render failed (${res.status})`);
        setUrl(data.url);
      } catch (err) {
        if (!cancelled && latest.current === requestKey) {
          setError(err instanceof Error ? err.message : 'render failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // requestKey captures every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  if (error) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-red-50 p-2 text-center text-[10px] text-red-500',
          className
        )}
        title={error}
      >
        render failed
      </div>
    );
  }
  if (!url) {
    return (
      <div className={cn('animate-pulse bg-[#f1efe8]', className)}>
        <span className="sr-only">Rendering…</span>
      </div>
    );
  }
  // Render-cache PNGs, not managed remote assets: next/image adds nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt ?? `Seed ${seed}`} className={cn('bg-white', className)} />;
}
