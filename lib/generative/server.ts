// Server-side plumbing for the generative section: locates the systems on
// disk, shells out to each system's node/render.js, and caches the PNGs it
// produces. Local-operator tooling: on a deploy without the workspace repo
// (Vercel) generativeRoot() returns null and the section degrades to
// browse-only copy with a clear notice.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { findSystem } from './registry'

/**
 * The generative/ folder of the workspace repo. Explicit via GENERATIVE_ROOT,
 * otherwise the admin's sibling directory (the workspace layout: the admin
 * app lives at <workspace>/artinscale-admin, systems at <workspace>/generative).
 */
export function generativeRoot(): string | null {
  const candidates = [
    process.env.GENERATIVE_ROOT,
    path.resolve(process.cwd(), '../generative'),
  ].filter((c): c is string => !!c)
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c
    } catch {
      // keep looking
    }
  }
  return null
}

/** Absolute system folder, or null when unknown/not present on this machine. */
export function systemDir(systemId: string): string | null {
  if (!findSystem(systemId)) return null
  const root = generativeRoot()
  if (!root) return null
  const dir = path.join(root, systemId)
  return fs.existsSync(path.join(dir, 'node', 'render.js')) ? dir : null
}

export type RenderKind = 'thumb' | 'preview' | 'master'

export interface RenderRequest {
  system: string
  kind: RenderKind
  seed: number
  /** Raw param values from the client; sanitized against the registry. */
  params?: Record<string, unknown>
}

export interface RenderResult {
  /** Path relative to the system folder, for the file route. */
  relPath: string
  cached: boolean
}

const PREVIEW_WIDTH: Record<Exclude<RenderKind, 'master'>, number> = {
  thumb: 480,
  preview: 1200,
}

/**
 * Keep only params the registry knows, drop canonical values (so untouched
 * controls yield the pack's canonical output and share one cache entry), and
 * coerce/clamp the rest. Returns CLI flag pairs.
 */
function sanitizeParams(
  systemId: string,
  raw: Record<string, unknown>
): Record<string, string> {
  const found = findSystem(systemId)
  if (!found) return {}
  const out: Record<string, string> = {}
  for (const spec of found.system.params) {
    const v = raw[spec.key]
    if (v === undefined || v === null || v === '') continue
    if (spec.kind === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n) || n === spec.def) continue
      out[spec.key] = String(Math.min(spec.max, Math.max(spec.min, n)))
    } else {
      const s = String(v)
      if (s === spec.def || !spec.options.includes(s)) continue
      out[spec.key] = s
    }
  }
  return out
}

// Renders are CPU-bound native-canvas work; two at a time keeps the grid
// filling briskly without starving the dev machine. Print masters take the
// same lane so a master never competes with itself.
const MAX_CONCURRENT = 2
let active = 0
const waiters: Array<() => void> = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}

// A second identical request while the first is still rendering should wait
// for that render, not spawn a duplicate process writing the same file.
const inFlight = new Map<string, Promise<RenderResult>>()

function runRenderer(
  dir: string,
  args: string[],
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['render.js', ...args],
      { cwd: path.join(dir, 'node'), timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`renderer failed: ${stderr || error.message}`.slice(0, 2000)))
        } else {
          resolve()
        }
      }
    )
  })
}

const seedTag = (seed: number) => `s${String(seed).padStart(6, '0')}`

// Files whose contents decide the pixels: the drawing algorithm and the
// RNG/noise primitives it draws from. render.js only parses flags and sizes
// the canvas, so it is deliberately excluded.
const VERSION_FILES = ['system.js', 'p5compat.js']

// stat identity (mtime + size) of the version files, so the common case is
// two stat calls rather than re-hashing the source on every thumbnail.
const versionCache = new Map<string, { stamp: string; version: string }>()

/**
 * Content hash of a system's algorithm, short hex.
 *
 * Derived rather than hand-maintained: editing a system changes its version
 * with nobody having to remember to bump a number. It keys the render cache
 * (so a changed algorithm can never serve an image drawn by the old one) and
 * is stamped on artpieces, which is what makes "seed + version reproduces
 * the piece" a checkable claim instead of an assumption.
 */
export function systemVersion(systemId: string): string | null {
  const dir = systemDir(systemId)
  if (!dir) return null
  const files = VERSION_FILES.map((f) => path.join(dir, 'node', f))
  let stamp = ''
  try {
    for (const f of files) {
      const st = fs.statSync(f)
      stamp += `${f}:${st.mtimeMs}:${st.size};`
    }
  } catch {
    return null
  }
  const cached = versionCache.get(systemId)
  if (cached?.stamp === stamp) return cached.version

  const hash = crypto.createHash('sha256')
  for (const f of files) hash.update(fs.readFileSync(f))
  const version = hash.digest('hex').slice(0, 10)
  versionCache.set(systemId, { stamp, version })
  return version
}

export async function renderCached(req: RenderRequest): Promise<RenderResult> {
  const dir = systemDir(req.system)
  if (!dir) throw new Error(`renderer unavailable for system "${req.system}"`)
  const seed = Math.floor(req.seed)
  if (!Number.isFinite(seed) || seed < 0 || seed > 99_999_999) {
    throw new Error('seed out of range')
  }

  const params = sanitizeParams(req.system, req.params ?? {})
  // The algorithm version is part of the key: without it an edited system
  // keeps serving images its code can no longer draw, and a stale print
  // master gets promoted as though it were the seed's piece.
  const version = systemVersion(req.system) ?? 'unknown'
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify({ kind: req.kind, seed, params, version }))
    .digest('hex')
    .slice(0, 10)

  const variant = Object.keys(params).length ? `-v${hash.slice(0, 6)}` : ''
  const relPath =
    req.kind === 'master'
      ? // Near the system's own master naming, plus the algorithm version:
        // the operator's CLI masters keep the plain name, and an admin
        // master is never mistaken for one drawn by different code.
        path.join(
          'node',
          'masters',
          `${req.system}-${seedTag(seed)}${variant}-alg-${version}-print-40x50-300dpi.png`
        )
      : path.join('node', 'cache', `${req.kind}-${seedTag(seed)}-${hash}.png`)

  const outFile = path.join(dir, relPath)
  if (fs.existsSync(outFile)) return { relPath, cached: true }

  const key = `${req.system}:${relPath}`
  const pending = inFlight.get(key)
  if (pending) return pending

  const flagArgs = Object.entries(params).flatMap(([k, v]) => [`--${k}`, v])
  const args =
    req.kind === 'master'
      ? ['master', String(seed), '--out', outFile, ...flagArgs]
      : [
          'seed',
          String(seed),
          '--width',
          String(PREVIEW_WIDTH[req.kind]),
          '--out',
          outFile,
          ...flagArgs,
        ]

  const job = withSlot(async () => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    // Masters are 4724x5906 with tens of thousands of strokes; give them room.
    await runRenderer(dir, args, req.kind === 'master' ? 10 * 60_000 : 2 * 60_000)
    if (!fs.existsSync(outFile)) throw new Error('renderer exited without output')
    return { relPath, cached: false }
  }).finally(() => inFlight.delete(key))

  inFlight.set(key, job)
  return job
}

/**
 * Resolve a client-supplied relative path inside a system folder, refusing
 * anything that escapes it. Only PNGs are served.
 */
export function resolveSystemFile(systemId: string, rel: string): string | null {
  const dir = systemDir(systemId)
  if (!dir) return null
  const abs = path.resolve(dir, rel)
  if (!abs.startsWith(dir + path.sep)) return null
  if (!abs.endsWith('.png')) return null
  return fs.existsSync(abs) ? abs : null
}
