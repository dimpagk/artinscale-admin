/**
 * Unit tests for the P&L metric math. Pure module, no I/O — run with:
 *   node --test lib/costs/pnl-metrics.test.ts
 * (Node >= 23 strips TypeScript types natively.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMetrics,
  displayLineAmount,
  metricValue,
  ALL_DISPLAY_LINES,
  OPEX_LINES,
  type LineSums,
} from './pnl-metrics.ts';

// A realistic month: two paid orders plus creation, marketing and tools.
// Revenue positive, costs negative — exactly how pnl_entries emits them.
const SAMPLE: LineSums = {
  gross_revenue: 200, // 2 × €100 subtotal
  shipping_revenue: 10,
  discounts: -20,
  vat: -30, // tax-inclusive prices
  production: -40,
  royalty_pct: -5,
  gelato_shipping: -8,
  payment_fees: -4.5,
  marketing: -25,
  ai_generation: -1.2,
  creation_processing: -1.2, // upscale + mockups
  creation_purchase: -50,
  royalty_flat: -50,
  tools_shopify: -29,
  tools_vercel: -20,
  other: -3,
};

test('net revenue = gross + shipping + discounts + vat', () => {
  const m = computeMetrics(SAMPLE);
  assert.equal(m.netRevenue, 160); // 200 + 10 - 20 - 30
});

test('CM1 nets out production and % royalties', () => {
  const m = computeMetrics(SAMPLE);
  assert.equal(m.cm1, 115); // 160 - 40 - 5
});

test('CM2 nets out fulfillment and payment fees', () => {
  const m = computeMetrics(SAMPLE);
  assert.equal(m.cm2, 102.5); // 115 - 8 - 4.5
});

test('CM3 nets out marketing', () => {
  const m = computeMetrics(SAMPLE);
  assert.equal(m.cm3, 77.5); // 102.5 - 25
});

test('EBITDA nets out all remaining opex', () => {
  const m = computeMetrics(SAMPLE);
  // 77.5 - 1.2 - 1.2 - 50 - 50 - 29 - 20 - 3 = -76.9
  assert.equal(m.ebitda, -76.9);
});

test('net profit equals EBITDA (no tax/interest/D&A yet)', () => {
  const m = computeMetrics(SAMPLE);
  assert.equal(m.netProfit, m.ebitda);
});

test('metrics are monotonic: each subtotal <= the one above it', () => {
  const m = computeMetrics(SAMPLE);
  assert.ok(m.netRevenue >= m.cm1);
  assert.ok(m.cm1 >= m.cm2);
  assert.ok(m.cm2 >= m.cm3);
  assert.ok(m.cm3 >= m.ebitda);
});

test('VAT is excluded from margin when prices are tax-exclusive', () => {
  // Same subtotal but no VAT baked in — net revenue is higher by the VAT.
  const noVat: LineSums = { ...SAMPLE, vat: 0 };
  assert.equal(computeMetrics(noVat).netRevenue, 190);
});

test('empty period yields all-zero metrics', () => {
  const m = computeMetrics({});
  assert.deepEqual(m, { netRevenue: 0, cm1: 0, cm2: 0, cm3: 0, ebitda: 0, netProfit: 0 });
});

test('float sums round to cents (no 0.1 + 0.2 drift)', () => {
  const m = computeMetrics({ gross_revenue: 0.1, shipping_revenue: 0.2 });
  assert.equal(m.netRevenue, 0.3);
});

test('tools display line aggregates every tools_* raw key', () => {
  const tools = OPEX_LINES.find((l) => l.key === 'tools')!;
  assert.equal(displayLineAmount(SAMPLE, tools), -49); // -29 + -20
});

test('metricValue routes each key to the right field', () => {
  const m = computeMetrics(SAMPLE);
  assert.equal(metricValue(m, 'net_revenue'), m.netRevenue);
  assert.equal(metricValue(m, 'ebitda'), m.ebitda);
  assert.equal(metricValue(m, 'net_profit'), m.netProfit);
});

test('display lines cover every raw key exactly once', () => {
  const seen = new Set<string>();
  for (const line of ALL_DISPLAY_LINES) {
    for (const k of line.rawKeys) {
      assert.ok(!seen.has(k), `raw key ${k} appears in more than one display line`);
      seen.add(k);
    }
  }
  // 22 raw keys defined; all should be displayed.
  assert.equal(seen.size, 22);
});

test('non-reclaimable Gelato VAT reduces CM1 (production) and CM2 (shipping)', () => {
  // Order #1001 shape: 19% VAT billed on top of Gelato's net prices while
  // the operator is not VAT-registered. Reclaimable VAT emits 0 rows from
  // SQL, so its absence here doubles as the reclaimable case.
  const withVat: LineSums = { ...SAMPLE, production_vat: -4.63, gelato_shipping_vat: -1.11 };
  const base = computeMetrics(SAMPLE);
  const m = computeMetrics(withVat);
  assert.equal(m.cm1, base.cm1 - 4.63);
  assert.equal(m.cm2, base.cm2 - 4.63 - 1.11);
  assert.equal(m.netRevenue, base.netRevenue); // revenue side untouched
});
