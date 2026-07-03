'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

export interface TrendPoint {
  label: string;
  netRevenue: number;
  cm2: number;
  ebitda: number;
}

/**
 * Net revenue (bars) against CM2 and EBITDA (lines) per period. The one
 * chart on the page — reads the trend at a glance, the matrix has the detail.
 *
 * Rendered client-only (after mount): recharts' ResponsiveContainer measures
 * the DOM, so its server HTML and client HTML differ and hydration would
 * throw. The pre-mount placeholder keeps server and first client render
 * identical, then the chart mounts on the client.
 */
export function PnlTrendChart({ data, currency }: { data: TrendPoint[]; currency: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);

  if (!mounted) return <div className="h-64 w-full" />;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(n) => fmt(Number(n))}
            width={64}
          />
          <Tooltip
            formatter={(value, name) => [fmt(Number(value)), String(name)]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="netRevenue" name="Net revenue" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="cm2" name="CM2" stroke="#6366f1" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="ebitda" name="EBITDA" stroke="#0f172a" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
