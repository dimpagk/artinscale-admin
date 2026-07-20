'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SeedImage } from './seed-image';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { SidebarCard } from '@/components/admin-ui';
import type { GenerativeParam } from '@/lib/generative/registry';

const PAGE_SIZE = 24;

const seedLabel = (seed: number) => 'S-' + String(seed).padStart(6, '0');

interface PromotedSeed {
  seed: number;
  artworkId: string;
  status: string;
}

/**
 * The seed browser for one system: walk seeds in pages, tune the system's
 * style params (canonical until touched), open a seed large, render a 40x50
 * print master, and turn a chosen seed into an artpiece. Seeds that are
 * already artworks carry a badge and deep-link to /artworks/[id].
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
  const [promoted, setPromoted] = useState<Map<number, PromotedSeed>>(new Map());
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  const refreshPromoted = useCallback(async () => {
    try {
      const res = await fetch(`/api/generative/promoted?system=${encodeURIComponent(system)}`);
      if (!res.ok) return;
      const data: { seeds: PromotedSeed[]; migrationNeeded: boolean } = await res.json();
      setPromoted(new Map(data.seeds.map((s) => [s.seed, s])));
      setMigrationNeeded(data.migrationNeeded);
    } catch {
      // Non-fatal: badges just stay off.
    }
  }, [system]);

  useEffect(() => {
    refreshPromoted();
  }, [refreshPromoted]);

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
        <SidebarCard title="Seeds">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom(Math.max(1, from - PAGE_SIZE));
                setSelected(null);
              }}
            >
              ← Prev
            </Button>
            <span className="flex-1 text-center font-mono text-xs text-gray-500">
              {seedLabel(from)} – {seedLabel(from + PAGE_SIZE - 1)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom(from + PAGE_SIZE);
                setSelected(null);
              }}
            >
              Next →
            </Button>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <Input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyJump()}
              placeholder="Jump to seed…"
              inputMode="numeric"
              size="sm"
            />
            <Button variant="outline" size="sm" onClick={applyJump}>
              Go
            </Button>
          </div>
          {promoted.size > 0 && (
            <p className="mt-3 text-[11px] text-gray-400">
              {promoted.size === 1
                ? '1 seed is already an artpiece.'
                : `${promoted.size} seeds are already artpieces.`}
            </p>
          )}
        </SidebarCard>

        {migrationNeeded && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-snug text-amber-800">
            Artpiece tracking is off: apply sql/049_generative_provenance.sql in the Supabase SQL
            editor to enable promotion and badges.
          </div>
        )}

        <SidebarCard
          title="Parameters"
          description="Untouched controls stay on the pack's canonical values."
          action={
            touchedCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStaged({});
                  setValues({});
                }}
              >
                Reset
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-3">
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
          <Button variant="primary" className="mt-4 w-full" disabled={!dirty} onClick={() => setValues(staged)}>
            Apply &amp; re-render page
          </Button>
        </SidebarCard>
      </aside>

      {/* ── grid ── */}
      <div className="min-w-0 flex-1">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {seeds.map((seed) => {
            const piece = promoted.get(seed);
            return (
              <button
                key={`${seed}-${JSON.stringify(values)}`}
                onClick={() => setSelected(seed)}
                className={cn(
                  'group relative overflow-hidden rounded-lg border bg-white text-left transition-shadow hover:shadow-md',
                  selected === seed
                    ? 'border-[var(--brand-navy)] ring-2 ring-[var(--brand-navy)]/20'
                    : 'border-gray-200'
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
                {piece && (
                  <Badge variant="success" size="sm" className="absolute right-1.5 top-1.5 shadow-sm">
                    artpiece{piece.status !== 'created' ? ` · ${piece.status}` : ''}
                  </Badge>
                )}
                <div className="px-2 py-1.5 font-mono text-[11px] text-gray-500">
                  {seedLabel(seed)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── detail ── */}
      {selected !== null && (
        <SeedDetail
          system={system}
          title={title}
          seed={selected}
          params={values}
          piece={promoted.get(selected) ?? null}
          migrationNeeded={migrationNeeded}
          onPromoted={refreshPromoted}
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
      <Select
        label={spec.label}
        size="sm"
        value={value === undefined ? spec.def : String(value)}
        onChange={(e) => onChange(e.target.value === spec.def ? undefined : e.target.value)}
        options={spec.options.map((o) => ({
          value: o,
          label: o === 'auto' ? 'auto (seeded)' : o,
        }))}
      />
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
      {/* The design system has no range slider yet; keep a native input
          tinted with the brand accent until one lands. */}
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
  piece,
  migrationNeeded,
  onPromoted,
  onClose,
}: {
  system: string;
  title: string;
  seed: number;
  params: Record<string, string | number>;
  piece: PromotedSeed | null;
  migrationNeeded: boolean;
  onPromoted: () => void;
  onClose: () => void;
}) {
  const paramsModified = Object.keys(params).length > 0;

  const [masterState, setMasterState] = useState<
    | { status: 'idle' }
    | { status: 'rendering' }
    | { status: 'done'; url: string; relPath: string; cached: boolean }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  const [promoteState, setPromoteState] = useState<
    | { status: 'idle' }
    | { status: 'working' }
    | { status: 'done'; artworkId: string; existing: boolean }
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

  const promote = async () => {
    setPromoteState({ status: 'working' });
    try {
      const res = await fetch('/api/generative/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, seed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `promotion failed (${res.status})`);
      setPromoteState({ status: 'done', artworkId: data.artworkId, existing: data.existing });
      onPromoted();
    } catch (err) {
      setPromoteState({
        status: 'error',
        message: err instanceof Error ? err.message : 'promotion failed',
      });
    }
  };

  const artworkId =
    piece?.artworkId ?? (promoteState.status === 'done' ? promoteState.artworkId : null);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={`${title} ${seedLabel(seed)}`}
      header={
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-sm text-gray-700">
            {title} {seedLabel(seed)}
          </h3>
          {paramsModified && (
            <Badge variant="warning" size="sm">
              modified params
            </Badge>
          )}
          {piece && (
            <Badge variant="success" size="sm">
              artpiece · {piece.status}
            </Badge>
          )}
        </div>
      }
      actions={
        <div className="w-full space-y-3">
          {/* master render */}
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
              <Button
                variant="outline"
                onClick={renderMaster}
                disabled={masterState.status === 'rendering'}
              >
                {masterState.status === 'rendering'
                  ? 'Rendering master… (can take minutes)'
                  : 'Render 40x50 print master'}
              </Button>
              {masterState.status === 'error' && (
                <span className="text-sm text-red-500">{masterState.message}</span>
              )}
            </div>
          )}

          {/* promotion */}
          {artworkId ? (
            <p className="text-sm text-gray-600">
              {promoteState.status === 'done' && !promoteState.existing
                ? 'Artpiece created.'
                : 'This seed is an artpiece.'}{' '}
              <a href={`/artworks/${artworkId}`} className="font-medium underline">
                Open artwork
              </a>{' '}
              to finish copy, pricing, Gelato push and listing.
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={promote}
                disabled={promoteState.status === 'working' || paramsModified || migrationNeeded}
              >
                {promoteState.status === 'working'
                  ? 'Creating artpiece… (renders the master first)'
                  : 'Turn into artpiece'}
              </Button>
              {paramsModified && (
                <span className="text-xs text-gray-400">
                  Promotion uses canonical parameters only; reset them first.
                </span>
              )}
              {migrationNeeded && (
                <span className="text-xs text-amber-700">Apply sql/049 first.</span>
              )}
              {promoteState.status === 'error' && (
                <span className="text-sm text-red-500">{promoteState.message}</span>
              )}
            </div>
          )}
        </div>
      }
    >
      <SeedImage
        system={system}
        seed={seed}
        kind="preview"
        params={params}
        className="mx-auto max-h-[58vh] w-auto rounded shadow"
        alt={`${title} ${seedLabel(seed)} preview`}
      />
    </Modal>
  );
}
