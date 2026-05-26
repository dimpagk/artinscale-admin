import { NextRequest, NextResponse, after } from 'next/server';
import { runExternalPrintPipeline } from '@/lib/external-print-pipeline';

// POST /api/external/create-on-demand
//
// Cross-app webhook from the storefront's request-print endpoint.
// Returns 200 immediately; the actual on-demand print pipeline runs
// in the background via next/server's `after()` so the storefront's
// fire-and-forget call returns straight away.
//
// Auth: AGENT_TRIGGER_TOKEN in the X-Trigger-Token header. Same pattern
// as /api/agents/run/[name]. Mirrors the middleware exclusion added in
// the same change.

const AGENT_TRIGGER_TOKEN = process.env.AGENT_TRIGGER_TOKEN;

function unauthorized(reason: string): NextResponse {
  return NextResponse.json({ error: `Unauthorized: ${reason}` }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-trigger-token');

  if (!AGENT_TRIGGER_TOKEN) {
    // Without a configured token, accept only localhost calls so dev
    // doesn't break but prod is never wide open.
    const url = new URL(request.url);
    const isLocal =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0';
    if (!isLocal) {
      return unauthorized('AGENT_TRIGGER_TOKEN not configured');
    }
  } else if (token !== AGENT_TRIGGER_TOKEN) {
    return unauthorized('bad token');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const externalPrintId = (body as { externalPrintId?: unknown })?.externalPrintId;
  if (typeof externalPrintId !== 'string' || externalPrintId.length === 0) {
    return NextResponse.json(
      { error: 'externalPrintId (string) required in body' },
      { status: 400 }
    );
  }

  // Fire-and-forget: storefront's request-print already returned a job_id;
  // the customer polls /api/external/print-status on the storefront which
  // reads directly from external_prints. We just need to run the pipeline
  // in the background and let it write status back to the row.
  after(async () => {
    try {
      await runExternalPrintPipeline(externalPrintId);
    } catch (err) {
      // Pipeline writes its own errors to the row; this catch is for the
      // very unusual case where the pipeline itself throws above its own
      // try/catch (e.g. import-time failure).
      console.error(`[create-on-demand] unhandled pipeline error for ${externalPrintId}:`, err);
    }
  });

  return NextResponse.json({ accepted: true, externalPrintId });
}
