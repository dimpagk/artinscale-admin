'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

/** All-time subtotal metrics that drive the waterfall. */
export interface WaterfallMetrics {
  grossRevenue: number;
  netRevenue: number;
  cm1: number;
  cm2: number;
  cm3: number;
  ebitda: number;
}

const INDIGO = '#6366f1'; // totals
const RED = '#f87171'; // costs (down steps)
const GREEN = '#34d399'; // gains (up steps)

interface WfBar {
  name: string;
  /** Floating bar span [low, high] on the value axis. */
  range: [number, number];
  /** Signed amount this bar represents (a total's value, or a step's delta). */
  amount: number;
  fill: string;
}

/**
 * Build the waterfall geometry: a Gross-revenue total on the left, one
 * floating step per cost group (each landing on the next margin), and an
 * EBITDA total on the right. A step's bar spans from the running subtotal to
 * where it lands, so the eye follows the money down to EBITDA. Steps are the
 * delta between consecutive margins, so they always reconcile.
 */
function buildWaterfall(m: WaterfallMetrics): WfBar[] {
  const steps: Array<{ name: string; kind: 'total' | 'step'; amount: number }> = [
    { name: 'Gross rev.', kind: 'total', amount: m.grossRevenue },
    { name: 'Disc.+VAT', kind: 'step', amount: m.netRevenue - m.grossRevenue },
    { name: 'COGS', kind: 'step', amount: m.cm1 - m.netRevenue },
    { name: 'Fees', kind: 'step', amount: m.cm2 - m.cm1 },
    { name: 'Marketing', kind: 'step', amount: m.cm3 - m.cm2 },
    { name: 'Creation+opex', kind: 'step', amount: m.ebitda - m.cm3 },
    { name: 'EBITDA', kind: 'total', amount: m.ebitda },
  ];

  let running = 0;
  return steps.map((s) => {
    if (s.kind === 'total') {
      running = s.amount;
      return {
        name: s.name,
        range: [Math.min(0, s.amount), Math.max(0, s.amount)] as [number, number],
        amount: s.amount,
        fill: s.amount < 0 ? RED : INDIGO,
      };
    }
    const start = running;
    const end = running + s.amount;
    running = end;
    return {
      name: s.name,
      range: [Math.min(start, end), Math.max(start, end)] as [number, number],
      amount: s.amount,
      fill: s.amount > 0 ? GREEN : RED,
    };
  });
}

/**
 * All-time P&L as a waterfall: how gross revenue erodes through each cost
 * group down to EBITDA. Client-only after mount (see the trend chart) to
 * avoid a recharts hydration mismatch.
 */
export function PnlAllTimeChart({ metrics, currency }: { metrics: WaterfallMetrics; currency: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  if (!mounted) return <div className="h-64 w-full" />;

  const data = buildWaterfall(metrics);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(n) => fmt(Number(n))}
            width={64}
          />
          <Tooltip
            cursor={{ fill: '#f8fafc' }}
            formatter={(_value, _name, item) => [
              fmt(Number((item?.payload as WfBar)?.amount ?? 0)),
              'amount',
            ]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <ReferenceLine y={0} stroke="#cbd5e1" />
          <Bar dataKey="range" radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
