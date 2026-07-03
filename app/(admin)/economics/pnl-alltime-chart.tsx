'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

/** All-time subtotal metrics that drive the staircase. */
export interface WaterfallMetrics {
  grossRevenue: number;
  netRevenue: number;
  cm1: number;
  cm2: number;
  cm3: number;
  ebitda: number;
}

const INDIGO = '#6366f1';
const RED = '#ef4444';

/**
 * All-time P&L as a stepped area: the running total staircases from Gross
 * revenue down through each margin to EBITDA. Each flat tread is a margin
 * level; each drop between treads is what that cost group ate. Drawn as an
 * area (no bars) with the fill split at zero — indigo while profitable, red
 * below the line. Client-only after mount (see the trend chart) to avoid a
 * recharts hydration mismatch.
 */
export function PnlAllTimeChart({ metrics, currency }: { metrics: WaterfallMetrics; currency: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  if (!mounted) return <div className="h-64 w-full" />;

  const data = [
    { name: 'Gross rev.', value: metrics.grossRevenue },
    { name: 'Net rev.', value: metrics.netRevenue },
    { name: 'CM1', value: metrics.cm1 },
    { name: 'CM2', value: metrics.cm2 },
    { name: 'CM3', value: metrics.cm3 },
    { name: 'EBITDA', value: metrics.ebitda },
  ];

  // Split the gradient exactly at y=0 so the area reads indigo while the
  // running total is profitable and red once it dips below zero.
  const values = data.map((d) => d.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const zeroOffset = max === min ? 0 : max / (max - min);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="pnlSplitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={zeroOffset} stopColor={INDIGO} stopOpacity={0.25} />
              <stop offset={zeroOffset} stopColor={RED} stopOpacity={0.2} />
            </linearGradient>
            <linearGradient id="pnlSplitStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={zeroOffset} stopColor={INDIGO} />
              <stop offset={zeroOffset} stopColor={RED} />
            </linearGradient>
          </defs>
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
            formatter={(value) => [fmt(Number(value)), 'running total']}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <ReferenceLine y={0} stroke="#cbd5e1" />
          <Area
            type="stepAfter"
            dataKey="value"
            stroke="url(#pnlSplitStroke)"
            strokeWidth={2}
            fill="url(#pnlSplitFill)"
            dot={{ r: 3, strokeWidth: 2, fill: '#fff' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
