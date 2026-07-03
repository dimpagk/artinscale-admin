import { NextResponse } from 'next/server';
import { pushArtworkMockupsToShopify } from '@/lib/mockup-publisher';

export const dynamic = 'force-dynamic';

/**
 * Push the composed 5-shot mockup set onto the artwork's Shopify product,
 * replacing Gelato's auto-generated default gallery.
 *
 * Session-protected admin route (like compose-mockups): the middleware
 * enforces the admin session, so no AGENT_TRIGGER_TOKEN is needed. The
 * same work is also reachable machine-to-machine via
 * `/api/agents/run/mockup_publisher` (Bearer-token) for cron/agents.
 *
 * POST /api/artworks/[id]/push-mockups
 *   -> { ok: true, data: PushMockupsResult } | { ok: false, error }
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await pushArtworkMockupsToShopify(id);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
