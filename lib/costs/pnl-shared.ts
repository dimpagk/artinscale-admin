/**
 * Client-safe P&L types + constants.
 *
 * Split out of pnl.ts so client components (the granularity toggle, the
 * matrix) can import these WITHOUT pulling in pnl.ts's server-only
 * `supabaseAdmin` import — which, bundled into the browser, throws
 * "supabaseKey is required" on instantiation. This module has no server
 * imports and is safe on both sides.
 */

export type PnlGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const GRANULARITIES: PnlGranularity[] = ['day', 'week', 'month', 'quarter', 'year'];

export interface DrilldownRow {
  occurred_on: string;
  line_key: string;
  amount: number;
  ref_type: string;
  ref_id: string;
  /** Resolved human label (order name, artwork/expense description, etc). */
  label: string;
  /** In-app link when the ref points at something with a page. */
  href: string | null;
}
