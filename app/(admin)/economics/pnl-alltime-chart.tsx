'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

/** One month's headline metrics (mirrors MonthlyMetricsPoint in lib/costs/pnl). */
export interface MetricSeriesPoint {
  label: string;
  grossRevenue: number;
  netRevenue: number;
  cm1: number;
  cm2: number;
  cm3: number;
  ebitda: number;
}

/**
 * Headline metrics over time: money (Y) by month (X) across all history.
 * Revenue and margin lines share the left axis; EBITDA gets its own right
 * axis (dashed line) because creation spend pushes it to a different scale
 * and it would flatten the others. Client-only after mount (see the trend
 * chart) to avoid a recharts hydration mismatch.
 */
export function PnlAllTimeChart({ data, currency }: { data: MetricSeriesPoint[]; currency: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  if (!mounted) return <div className="h-64 w-full" />;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(n) => fmt(Number(n))}
            width={60}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: '#0f172a' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(n) => fmt(Number(n))}
            width={60}
          />
          <Tooltip
            formatter={(value, name) => [fmt(Number(value)), String(name)]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine yAxisId="right" y={0} stroke="#e2e8f0" />
          <Line yAxisId="left" type="monotone" dataKey="grossRevenue" name="Gross rev." stroke="#c7d2fe" strokeWidth={2} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="netRevenue" name="Net rev." stroke="#6366f1" strokeWidth={2} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="cm1" name="CM1" stroke="#0ea5e9" strokeWidth={2} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="cm2" name="CM2" stroke="#10b981" strokeWidth={2} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="cm3" name="CM3" stroke="#f59e0b" strokeWidth={2} dot={false} />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="ebitda"
            name="EBITDA (right)"
            stroke="#0f172a"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
