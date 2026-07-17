'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SidebarCard } from '@/components/admin-ui';
import { createSocialDraftAction } from '@/app/(admin)/artworks/actions';
import type { SocialDraftKind } from '@/lib/social-drafts';

/**
 * One-click social drafts from this artwork's mockup set. Creates a
 * draft in the Content studio (never publishes): a feed carousel in the
 * canonical image order (framed, room, zooms, branded CTA slide) or a
 * 9:16 story. Text is rendered by the branded canvas blocks only.
 */
export function SocialDraftButtons({
  artworkId,
  hasMockups,
}: {
  artworkId: string;
  hasMockups: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [lastPostId, setLastPostId] = useState<string | null>(null);

  function generate(kind: SocialDraftKind) {
    startTransition(async () => {
      const r = await createSocialDraftAction(artworkId, kind);
      if (r.ok && r.postId) {
        setLastPostId(r.postId);
        toast.success(r.message);
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <SidebarCard title="Social drafts">
      {hasMockups ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Compose a draft from the mockup set (framed first, plain
            original only as a spare zoom). Review and export it in the
            Content studio; nothing publishes from here.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => generate('carousel')}
            >
              Generate carousel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => generate('story')}
            >
              Generate story
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => generate('ad')}
            >
              Generate ad kit
            </Button>
          </div>
          {lastPostId && (
            <Link
              href={`/content/${lastPostId}`}
              className="block text-xs font-medium text-blue-600 hover:underline"
            >
              Open the new draft in the Content studio
            </Link>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          No mockup set yet. Generate mockups first; social drafts are
          composed from the framed, room, and zoom images.
        </p>
      )}
    </SidebarCard>
  );
}
