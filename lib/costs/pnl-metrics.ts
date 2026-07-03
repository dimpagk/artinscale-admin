/**
 * P&L line taxonomy + metric math — the single, pure, testable definition
 * of how raw pnl_entries line sums roll up into a profit & loss statement.
 *
 * pnl_entries emits SIGNED amounts (revenue positive, costs negative) keyed
 * by a raw line key. This module groups those keys into the P&L's display
 * lines and computes the subtotal metrics (Net revenue, CM1/Gross profit,
 * CM2, CM3, EBITDA, Net profit). No I/O, no framework imports, so it can be
 * unit-tested directly and reused by both the matrix and the trend chart.
 */

/** Raw line keys, exactly as emitted by the pnl_entries view. */
export const RAW_LINE_KEYS = [
  'gross_revenue',
  'shipping_revenue',
  'discounts',
  'vat',
  'production',
  'royalty_pct',
  'gelato_shipping',
  'payment_fees',
  'marketing',
  'ai_generation',
  'creation_processing',
  'creation_purchase',
  'royalty_flat',
  'tools_shopify',
  'tools_gelato',
  'tools_vercel',
  'tools_ai',
  'tools_other',
  'shipping_other',
  'other',
] as const;

export type RawLineKey = (typeof RAW_LINE_KEYS)[number];

/** A period's summed amount per raw line key (missing keys treated as 0). */
export type LineSums = Partial<Record<string, number>>;

/** A display line groups one or more raw keys under a human label. */
export interface DisplayLine {
  key: string;
  label: string;
  rawKeys: RawLineKey[];
  /** Render bold like a subtotal (Gross revenue is the headline top line). */
  emphasis?: boolean;
}

// ── The P&L structure, top to bottom ─────────────────────────────
// Each block of lines is followed by a metric subtotal (see METRICS).

export const REVENUE_LINES: DisplayLine[] = [
  { key: 'gross_revenue', label: 'Gross revenue', rawKeys: ['gross_revenue'], emphasis: true },
  { key: 'shipping_revenue', label: 'Shipping charged', rawKeys: ['shipping_revenue'] },
  { key: 'discounts', label: 'Discounts', rawKeys: ['discounts'] },
  { key: 'vat', label: 'VAT (pass-through)', rawKeys: ['vat'] },
];

export const COGS_LINES: DisplayLine[] = [
  { key: 'production', label: 'Production (Gelato)', rawKeys: ['production'] },
  { key: 'royalty_pct', label: 'Artist royalties (%)', rawKeys: ['royalty_pct'] },
];

export const FULFILLMENT_LINES: DisplayLine[] = [
  { key: 'gelato_shipping', label: 'Gelato shipping', rawKeys: ['gelato_shipping'] },
  { key: 'payment_fees', label: 'Payment fees', rawKeys: ['payment_fees'] },
];

export const MARKETING_LINES: DisplayLine[] = [
  { key: 'marketing', label: 'Marketing', rawKeys: ['marketing'] },
];

export const OPEX_LINES: DisplayLine[] = [
  { key: 'ai_generation', label: 'AI generation', rawKeys: ['ai_generation'] },
  { key: 'creation_processing', label: 'Upscales + mockups', rawKeys: ['creation_processing'] },
  { key: 'creation_purchase', label: 'Buying art / licenses', rawKeys: ['creation_purchase'] },
  { key: 'royalty_flat', label: 'Artist flat fees', rawKeys: ['royalty_flat'] },
  {
    key: 'tools',
    label: 'Tools & subscriptions',
    rawKeys: ['tools_shopify', 'tools_gelato', 'tools_vercel', 'tools_ai', 'tools_other'],
  },
  { key: 'other', label: 'Other opex', rawKeys: ['shipping_other', 'other'] },
];

/** All display lines in top-to-bottom order. */
export const ALL_DISPLAY_LINES: DisplayLine[] = [
  ...REVENUE_LINES,
  ...COGS_LINES,
  ...FULFILLMENT_LINES,
  ...MARKETING_LINES,
  ...OPEX_LINES,
];

export type MetricKey = 'net_revenue' | 'cm1' | 'cm2' | 'cm3' | 'ebitda' | 'net_profit';

export interface MetricDef {
  key: MetricKey;
  label: string;
  /** Renders after the display line with this key (its block's last line). */
  afterLineKey: string;
  note?: string;
}

/**
 * Where each subtotal sits in the statement. Cumulative, top to bottom:
 * every metric is the running total of all revenue + all costs above it.
 */
export const METRICS: MetricDef[] = [
  { key: 'net_revenue', label: 'Net revenue', afterLineKey: 'vat', note: 'ex-VAT, after discounts' },
  { key: 'cm1', label: 'CM1 / Gross profit', afterLineKey: 'royalty_pct', note: 'after production + royalties' },
  { key: 'cm2', label: 'CM2', afterLineKey: 'payment_fees', note: 'after fulfillment + fees' },
  { key: 'cm3', label: 'CM3', afterLineKey: 'marketing', note: 'after marketing' },
  { key: 'ebitda', label: 'EBITDA', afterLineKey: 'other', note: 'after creation + tools + opex' },
];

function sumRaw(sums: LineSums, keys: readonly RawLineKey[]): number {
  return round2(keys.reduce((acc, k) => acc + (sums[k] ?? 0), 0));
}

/** Total for one display line (already signed). */
export function displayLineAmount(sums: LineSums, line: DisplayLine): number {
  return sumRaw(sums, line.rawKeys);
}

export interface PnlMetrics {
  netRevenue: number;
  cm1: number;
  cm2: number;
  cm3: number;
  ebitda: number;
  netProfit: number;
}

/**
 * Compute all subtotal metrics from a period's raw line sums. Costs are
 * negative in the input, so each metric is a running sum. `net_profit`
 * equals EBITDA today (tax / interest / D&A are zero placeholders).
 */
export function computeMetrics(sums: LineSums): PnlMetrics {
  const revenue = sumRaw(sums, ['gross_revenue', 'shipping_revenue', 'discounts', 'vat']);
  const cogs = sumRaw(sums, ['production', 'royalty_pct']);
  const fulfillment = sumRaw(sums, ['gelato_shipping', 'payment_fees']);
  const marketing = sumRaw(sums, ['marketing']);
  const opex = sumRaw(sums, [
    'ai_generation',
    'creation_processing',
    'creation_purchase',
    'royalty_flat',
    'tools_shopify',
    'tools_gelato',
    'tools_vercel',
    'tools_ai',
    'tools_other',
    'shipping_other',
    'other',
  ]);

  const netRevenue = round2(revenue);
  const cm1 = round2(netRevenue + cogs);
  const cm2 = round2(cm1 + fulfillment);
  const cm3 = round2(cm2 + marketing);
  const ebitda = round2(cm3 + opex);
  // Corporate tax / interest / D&A are not modelled yet (placeholder 0).
  const netProfit = ebitda;

  return { netRevenue, cm1, cm2, cm3, ebitda, netProfit };
}

/** Look up a computed metric by its key (for placing subtotal rows). */
export function metricValue(metrics: PnlMetrics, key: MetricKey): number {
  switch (key) {
    case 'net_revenue':
      return metrics.netRevenue;
    case 'cm1':
      return metrics.cm1;
    case 'cm2':
      return metrics.cm2;
    case 'cm3':
      return metrics.cm3;
    case 'ebitda':
      return metrics.ebitda;
    case 'net_profit':
      return metrics.netProfit;
  }
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
