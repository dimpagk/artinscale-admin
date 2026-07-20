'use client';

import { useMemo, useState } from 'react';
import { SeedImage } from './seed-image';
import { cn } from '@/lib/utils';
import type { GenerativeParam } from '@/lib/generative/registry';

const PAGE_SIZE = 24;

const seedLabel = (seed: number) => 'S-' + String(seed).padStart(6, '0');

/**
 * The seed browser for one system: walk seeds in pages, tune the system's
 * style params (canonical until touched), open a seed large, and render a
 * 40x50 300dpi print master for a chosen seed.
 */
export function SystemBrowser({
  system,
  title,
  paramSpecs,
}: {
  system: string;
  title: string;
  paramSpecs: GenerativeParam[];
}) {
  const [from, setFrom] = useState(1);
  const [jump, setJump] = useState('');
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  // Param edits are staged, then applied in one go: every applied change
  // re-renders the whole visible page, so we don't fire 24 renders per tick
  // of a number input.
  const [staged, setStaged] = useState<Record<string, string | number>>({});

  const seeds = useMemo(
    () => Array.from({ length: PAGE_SIZE }, (_, i) => from + i),
    [from]
  );
  const dirty = useMemo(() => JSON.stringify(staged) !== JSON.stringify(values), [staged, values]);
  const touchedCount = Object.keys(values).length;

  const applyJump = () => {
    const n = parseInt(jump, 10);
    if (Number.isFinite(n) && n >= 0) {
      setFrom(n);
      setSelected(null);
    }
    setJump('');
  };

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      {/* ── controls ── */}
      <aside className="w-full shrink-0 space-y-5 xl:w-64">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Seeds</h2>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => {
                setFrom(Math.max(1, from - PAGE_SIZE));
                setSelected(null);
              }}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              ← Prev
            </button>
            <span className="flex-1 text-center font-mono text-xs text-gray-500">
              {seedLabel(from)} – {seedLabel(from + PAGE_SIZE - 1)}
            </span>
            <button
              onClick={() => {
                setFrom(from + PAGE_SIZE);
                setSelected(null);
              }}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyJump()}
              placeholder="Jump to seed…"
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-sm placeholder:font-sans"
            />
            <button
              onClick={applyJump}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Go
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Parameters
            </h2>
            {touchedCount > 0 && (
              <button
                onClick={() => {
                  setStaged({});
                  setValues({});
                }}
                className="text-xs text-gray-400 underline hover:text-gray-600"
              >
                Reset to canonical
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-gray-400">
            Untouched controls stay on the pack&apos;s canonical values.
          </p>
          <div className="mt-3 space-y-3">
            {paramSpecs.map((spec) => (
              <ParamControl
                key={spec.key}
                spec={spec}
                value={staged[spec.key]}
                onChange={(v) =>
                  setStaged((prev) => {
                    const next = { ...prev };
                    if (v === undefined) delete next[spec.key];
                    else next[spec.key] = v;
                    return next;
                  })
                }
              />
            ))}
          </div>
          <button
            onClick={() => setValues(staged)}
            disabled={!dirty}
            className={cn(
              'mt-4 w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              dirty
                ? 'bg-[var(--brand-navy)] text-white hover:opacity-90'
                : 'cursor-default bg-gray-100 text-gray-400'
            )}
          >
            Apply &amp; re-render page
          </button>
        </div>
      </aside>

      {/* ── grid ── */}
      <div className="min-w-0 flex-1">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {seeds.map((seed) => (
            <button
              key={`${seed}-${JSON.stringify(values)}`}
              onClick={() => setSelected(seed)}
              className={cn(
                'group overflow-hidden rounded-lg border bg-white text-left transition-shadow hover:shadow-md',
                selected === seed ? 'border-[var(--brand-navy)] ring-2 ring-[var(--brand-navy)]/20' : 'border-gray-200'
              )}
            >
              <SeedImage
                system={system}
                seed={seed}
                kind="thumb"
                params={values}
                className="aspect-[4/5] w-full object-cover"
                alt={`${title} ${seedLabel(seed)}`}
              />
              <div className="px-2 py-1.5 font-mono text-[11px] text-gray-500">
                {seedLabel(seed)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── detail ── */}
      {selected !== null && (
        <SeedDetail
          system={system}
          title={title}
          seed={selected}
          params={values}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ParamControl({
  spec,
  value,
  onChange,
}: {
  spec: GenerativeParam;
  value: string | number | undefined;
  onChange: (v: string | number | undefined) => void;
}) {
  if (spec.kind === 'select') {
    return (
      <label className="block">
        <span className="text-xs font-medium text-gray-600">{spec.label}</span>
        <select
          value={value === undefined ? spec.def : String(value)}
          onChange={(e) => onChange(e.target.value === spec.def ? undefined : e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
        >
          {spec.options.map((o) => (
            <option key={o} value={o}>
              {o === 'auto' ? 'auto (seeded)' : o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-gray-600">{spec.label}</span>
        <span className="font-mono text-[11px] text-gray-400">
          {value === undefined ? `${spec.def}` : value}
        </span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value === undefined ? spec.def : Number(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(n === spec.def ? undefined : n);
        }}
        className="mt-1 w-full accent-[var(--brand-navy)]"
      />
    </label>
  );
}

function SeedDetail({
  system,
  title,
  seed,
  params,
  onClose,
}: {
  system: string;
  title: string;
  seed: number;
  params: Record<string, string | number>;
  onClose: () => void;
}) {
  const [masterState, setMasterState] = useState<
    | { status: 'idle' }
    | { status: 'rendering' }
    | { status: 'done'; url: string; relPath: string; cached: boolean }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  const renderMaster = async () => {
    setMasterState({ status: 'rendering' });
    try {
      const res = await fetch('/api/generative/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, seed, kind: 'master', params }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `render failed (${res.status})`);
      setMasterState({ status: 'done', url: data.url, relPath: data.relPath, cached: data.cached });
    } catch (err) {
      setMasterState({
        status: 'error',
        message: err instanceof Error ? err.message : 'render failed',
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h3 className="font-mono text-sm text-gray-700">
            {title} {seedLabel(seed)}
            {Object.keys(params).length > 0 && (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 font-sans text-[11px] text-amber-700">
                modified params
              </span>
            )}
          </h3>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-5">
          <SeedImage
            system={system}
            seed={seed}
            kind="preview"
            params={params}
            className="mx-auto max-h-[62vh] w-auto rounded shadow"
            alt={`${title} ${seedLabel(seed)} preview`}
          />
        </div>
        <div className="border-t border-gray-100 px-5 py-3">
          {masterState.status === 'done' ? (
            <p className="text-sm text-gray-600">
              Print master {masterState.cached ? 'already on disk' : 'rendered'}:{' '}
              <a href={masterState.url} target="_blank" className="underline">
                open PNG
              </a>{' '}
              <span className="font-mono text-xs text-gray-400">({masterState.relPath})</span>
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={renderMaster}
                disabled={masterState.status === 'rendering'}
                className={cn(
                  'rounded-lg px-4 py-2 text-sm font-medium text-white',
                  masterState.status === 'rendering'
                    ? 'cursor-wait bg-gray-300'
                    : 'bg-[var(--brand-navy)] hover:opacity-90'
                )}
              >
                {masterState.status === 'rendering'
                  ? 'Rendering master… (can take minutes)'
                  : 'Render 40x50 print master'}
              </button>
              {masterState.status === 'error' && (
                <span className="text-sm text-red-500">{masterState.message}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
