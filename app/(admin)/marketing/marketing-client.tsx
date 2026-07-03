'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import type {
  AdCreative,
  AdCreativeGroup,
  AdCreativeStatus,
} from '@/lib/ad-creatives';
import { saveAdCreativeAction, setAdCreativeStatusAction } from './actions';

const STATUS_BADGE: Record<
  AdCreativeStatus,
  { label: string; variant: 'success' | 'warning' | 'error' }
> = {
  approved: { label: 'approved', variant: 'success' },
  draft: { label: 'draft', variant: 'warning' },
  rejected: { label: 'rejected', variant: 'error' },
};

const FORMAT_LABEL: Record<string, string> = {
  in_room: 'In-room mockup',
  flat: 'Flat artwork',
  video: 'Video',
};

function CreativeRow({ creative }: { creative: AdCreative }) {
  const [headline, setHeadline] = useState(creative.headline);
  const [primaryText, setPrimaryText] = useState(creative.primary_text);
  const [notes, setNotes] = useState(creative.notes ?? '');
  const [pending, startTransition] = useTransition();

  const dirty =
    headline !== creative.headline ||
    primaryText !== creative.primary_text ||
    (notes || null) !== (creative.notes ?? null);

  const badge = STATUS_BADGE[creative.status];

  function save() {
    startTransition(async () => {
      const r = await saveAdCreativeAction({
        id: creative.id,
        headline,
        primaryText,
        notes,
      });
      r.ok ? toast.success('Saved.') : toast.error(r.message);
    });
  }

  function setStatus(status: AdCreativeStatus) {
    startTransition(async () => {
      const r = await setAdCreativeStatusAction({ id: creative.id, status });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {FORMAT_LABEL[creative.format] ?? creative.format}
          </span>
          {creative.ai_disclosure && (
            <Badge variant="secondary" size="sm">
              AI disclosure on
            </Badge>
          )}
        </div>
        <Badge variant={badge.variant} size="sm">
          {badge.label}
        </Badge>
      </div>

      <Input
        label="Headline"
        size="sm"
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        placeholder="Short headline"
      />
      <Textarea
        label="Primary text"
        rows={3}
        value={primaryText}
        onChange={(e) => setPrimaryText(e.target.value)}
        placeholder="Primary ad text"
      />
      <Textarea
        label="Notes"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Internal notes (e.g. policy caveats)"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={pending || !dirty}
          onClick={save}
        >
          {dirty ? 'Save changes' : 'Saved'}
        </Button>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || creative.status === 'approved'}
            onClick={() => setStatus('approved')}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || creative.status === 'rejected'}
            onClick={() => setStatus('rejected')}
          >
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

function fmtPrice(price: number | null, currency: string | null): string {
  if (price == null) return '';
  const symbol = currency === 'EUR' ? '€' : (currency ? currency + ' ' : '');
  return `${symbol}${price.toFixed(0)}`;
}

function CarouselStrip({ images }: { images: AdCreativeGroup['images'] }) {
  if (images.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        No mockup set yet. Run the compose pipeline for this piece.
      </p>
    );
  }

  function copyOne(url: string) {
    navigator.clipboard.writeText(url).then(
      () => toast.success('Image URL copied.'),
      () => toast.error('Copy failed.')
    );
  }

  function copyAll() {
    navigator.clipboard
      .writeText(images.map((i) => i.url).join('\n'))
      .then(
        () => toast.success(`Copied ${images.length} URLs in carousel order.`),
        () => toast.error('Copy failed.')
      );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">
          Carousel order (framed to plain)
        </span>
        <button
          type="button"
          onClick={copyAll}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          Copy all URLs
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((img, i) => (
          <button
            key={img.url}
            type="button"
            onClick={() => copyOne(img.url)}
            title={`Copy URL: ${img.label}`}
            className="group relative shrink-0"
          >
            <Image
              src={img.url}
              alt={img.label}
              width={72}
              height={72}
              className="h-[72px] w-[72px] rounded-md object-cover ring-1 ring-gray-200 group-hover:ring-blue-400"
              unoptimized
            />
            <span className="mt-1 block text-center text-[10px] text-gray-500">
              {i + 1}. {img.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PieceCard({ group }: { group: AdCreativeGroup }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-gray-900">
            {group.title}
          </h2>
          <p className="text-sm text-gray-500">
            {fmtPrice(group.price, group.currency)} ·{' '}
            {group.creatives.length} creative
            {group.creatives.length === 1 ? '' : 's'}
          </p>
        </div>

        <CarouselStrip images={group.images} />

        <div className="space-y-3">
          {group.creatives.map((c) => (
            <CreativeRow key={c.id} creative={c} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function MarketingClient({ groups }: { groups: AdCreativeGroup[] }) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-gray-500">
          No ad copy has been seeded yet. Apply{' '}
          <code className="rounded bg-gray-100 px-1">sql/046_ad_creatives.sql</code>{' '}
          in Supabase, then run{' '}
          <code className="rounded bg-gray-100 px-1">
            node scripts/seed-ad-creatives.mjs
          </code>{' '}
          from the admin app.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {groups.map((g) => (
        <PieceCard key={g.artworkId} group={g} />
      ))}
    </div>
  );
}
