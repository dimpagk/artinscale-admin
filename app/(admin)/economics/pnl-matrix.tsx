'use client';

import { useState, useTransition } from 'react';
import { drilldownAction } from './actions';
import type { PnlGranularity, DrilldownRow } from '@/lib/costs/pnl-shared';

export interface MatrixColumn {
  period: string;
  label: string;
  netRevenue: number;
}

export interface MatrixRow {
  key: string;
  label: string;
  kind: 'line' | 'metric';
  note?: string;
  emphasis?: boolean;
  values: number[];
  allTime: number;
}

interface Props {
  granularity: PnlGranularity;
  columns: MatrixColumn[];
  rows: MatrixRow[];
  currency: string;
}

/**
 * The P&L statement as a matrix: display lines + subtotal metrics down the
 * side, periods across the top. Toggle "% of net revenue" for margin
 * analysis; click any line cell to drill into the orders / expenses behind
 * it.
 */
export function PnlMatrix({ granularity, columns, rows, currency }: Props) {
  const [percentMode, setPercentMode] = useState(false);
  const [open, setOpen] = useState<{ rowKey: string; col: number } | null>(null);
  const [drill, setDrill] = useState<DrilldownRow[]>([]);
  const [pending, startTransition] = useTransition();

  const money = (n: number) =>
    new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(n);

  // All-time net revenue is the base for the All-time column's % mode.
  const allTimeNet = rows.find((r) => r.key === 'net_revenue')?.allTime ?? 0;

  function fmtCell(value: number, base: number): string {
    if (percentMode) {
      if (!base) return '—';
      return `${((value / base) * 100).toFixed(0)}%`;
    }
    if (value === 0) return '·';
    return money(value);
  }

  const cell = (value: number, col: number) => fmtCell(value, columns[col]?.netRevenue ?? 0);
  const allTimeCell = (value: number) => fmtCell(value, allTimeNet);

  function openCell(row: MatrixRow, col: number) {
    if (row.kind !== 'line') return;
    const same = open && open.rowKey === row.key && open.col === col;
    if (same) {
      setOpen(null);
      return;
    }
    setOpen({ rowKey: row.key, col });
    setDrill([]);
    startTransition(async () => {
      const result = await drilldownAction(granularity, columns[col].period, row.key);
      setDrill(result);
    });
  }

  const openRow = open ? rows.find((r) => r.key === open.rowKey) : null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Profit &amp; loss</h2>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={percentMode}
            onChange={(e) => setPercentMode(e.target.checked)}
            className="rounded border-gray-300"
          />
          % of net revenue
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-right text-xs uppercase tracking-wide text-gray-400">
              <th className="sticky left-0 z-10 bg-white py-2 pr-3 text-left font-medium">Line</th>
              <th className="whitespace-nowrap border-r border-gray-200 bg-indigo-50/50 py-2 px-3 font-semibold text-gray-500">
                All time
              </th>
              {columns.map((c) => (
                <th key={c.period} className="whitespace-nowrap py-2 pl-3 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isMetric = row.kind === 'metric';
              // Gross revenue is a line (still drillable) but rendered bold
              // like a subtotal via `emphasis`.
              const bold = isMetric || !!row.emphasis;
              const clickable = !isMetric;
              return (
                <tr
                  key={row.key}
                  className={`${
                    bold ? 'border-t border-gray-200 bg-gray-50/60' : 'border-b border-gray-50'
                  } ${clickable ? 'hover:bg-indigo-50/40' : ''}`}
                >
                  <td
                    className={`sticky left-0 z-10 py-1.5 pr-3 text-left ${
                      bold ? 'bg-gray-50/60 font-semibold text-gray-900' : 'bg-white text-gray-500'
                    }`}
                  >
                    {row.label}
                    {row.note && <span className="ml-1 text-xs font-normal text-gray-400">· {row.note}</span>}
                  </td>
                  <td
                    className={`whitespace-nowrap border-r border-gray-200 bg-indigo-50/50 py-1.5 px-3 text-right tabular-nums ${
                      bold ? 'font-semibold text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    {allTimeCell(row.allTime)}
                  </td>
                  {row.values.map((v, i) => {
                    const isOpen = open?.rowKey === row.key && open.col === i;
                    return (
                      <td
                        key={i}
                        onClick={() => clickable && openCell(row, i)}
                        className={`whitespace-nowrap py-1.5 pl-3 text-right tabular-nums ${
                          bold ? 'font-semibold text-gray-900' : v < 0 ? 'text-gray-600' : 'text-gray-800'
                        } ${clickable ? 'cursor-pointer' : ''} ${
                          isOpen ? 'bg-indigo-100 ring-1 ring-inset ring-indigo-300' : ''
                        }`}
                        title={clickable ? 'Click to drill in' : undefined}
                      >
                        {cell(v, i)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drill-down panel */}
      {open && openRow && (
        <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-700">
              {openRow.label} · {columns[open.col].label}
            </h3>
            <button onClick={() => setOpen(null)} className="text-xs text-gray-400 hover:text-gray-700">
              close
            </button>
          </div>
          {pending ? (
            <p className="py-2 text-xs text-gray-400">Loading…</p>
          ) : drill.length === 0 ? (
            <p className="py-2 text-xs text-gray-400">No underlying entries.</p>
          ) : (
            <ul className="divide-y divide-indigo-100 text-sm">
              {drill.map((d, i) => (
                <li key={`${d.ref_type}:${d.ref_id}:${i}`} className="flex items-center justify-between py-1.5">
                  <span className="text-gray-600">
                    <span className="text-gray-400">{d.occurred_on}</span>{' '}
                    {d.href ? (
                      <a href={d.href} className="text-indigo-600 hover:underline">
                        {d.label}
                      </a>
                    ) : (
                      d.label
                    )}
                  </span>
                  <span className="tabular-nums text-gray-800">{money(d.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
