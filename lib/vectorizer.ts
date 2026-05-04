/**
 * Vector layer studio.
 *
 * Converts a raster artwork (from the AI Art Generator) into a layered
 * SVG by calling Replicate's vtracer model. Output: an SVG string +
 * separate "color band" sub-SVGs that can be re-colored independently
 * to produce palette variants.
 *
 * Required env:
 *   - REPLICATE_API_TOKEN
 *   - VECTORIZER_DRY_RUN=true   for local dev without a Replicate account
 *
 * The PHASE_0_AUDIT §3.6 print-safety constraint applies: vectors solve
 * scale-to-any-size losslessly, but only for styles that vectorize
 * cleanly (risograph, line-art, geometric). Photorealistic outputs
 * will produce brittle SVGs.
 *
 * Reference:
 *   https://replicate.com/cjwbw/vtracer
 *   https://www.visioncortex.org/vtracer
 */

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN
const DRY_RUN = process.env.VECTORIZER_DRY_RUN === 'true'

const MODEL_VERSION =
  process.env.REPLICATE_VTRACER_MODEL_VERSION ??
  // Pinned reasonable default. Operator can override via env.
  'cjwbw/vtracer:latest'

export interface VectorizeArgs {
  imageUrl: string
  /** Color tolerance — higher = fewer color bands, simpler SVG */
  colorPrecision?: number  // default 6
  /** Minimum path size in px — filters tiny artifacts */
  filterSpeckleSize?: number  // default 4
  /** "spline" produces smoother curves; "polygon" is sharper */
  pathFidelity?: 'spline' | 'polygon'
}

export interface VectorizeResult {
  svg: string
  /** Number of color bands present in the SVG (best-effort count) */
  colorBandCount: number
  isDryRun?: boolean
}

export async function vectorizeImage(args: VectorizeArgs): Promise<VectorizeResult> {
  if (DRY_RUN) {
    console.log('[Vectorizer] DRY RUN — would vectorize:', args.imageUrl)
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#eee"/><text x="50" y="50" text-anchor="middle" font-size="8">DRY_RUN</text></svg>`,
      colorBandCount: 1,
      isDryRun: true,
    }
  }

  if (!REPLICATE_API_TOKEN) {
    throw new Error(
      'REPLICATE_API_TOKEN missing. Set VECTORIZER_DRY_RUN=true for local testing.'
    )
  }

  const startRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: MODEL_VERSION,
      input: {
        image: args.imageUrl,
        mode: args.pathFidelity ?? 'spline',
        color_precision: args.colorPrecision ?? 6,
        filter_speckle: args.filterSpeckleSize ?? 4,
      },
    }),
  })

  if (!startRes.ok) {
    const body = await startRes.text()
    throw new Error(`Replicate start error ${startRes.status}: ${body}`)
  }

  const started = (await startRes.json()) as {
    id: string
    urls: { get: string }
  }

  // Poll until succeeded or failed (max ~2min)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await sleep(2000)
    const pollRes = await fetch(started.urls.get, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    })
    if (!pollRes.ok) {
      const body = await pollRes.text()
      throw new Error(`Replicate poll error ${pollRes.status}: ${body}`)
    }
    const polled = (await pollRes.json()) as {
      status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
      output?: string | string[]
      error?: string
    }

    if (polled.status === 'succeeded') {
      const outputUrl = Array.isArray(polled.output) ? polled.output[0] : polled.output
      if (!outputUrl) throw new Error('Replicate succeeded but returned no output URL')
      const svgRes = await fetch(outputUrl)
      if (!svgRes.ok) throw new Error(`Failed to download SVG: ${svgRes.status}`)
      const svg = await svgRes.text()
      return {
        svg,
        colorBandCount: countColorBands(svg),
      }
    }
    if (polled.status === 'failed' || polled.status === 'canceled') {
      throw new Error(`Replicate prediction ${polled.status}: ${polled.error ?? '(no error message)'}`)
    }
  }

  throw new Error('Replicate vectorization timed out after 2 minutes')
}

/**
 * Replace the fill colors of a vectorized SVG with a new palette.
 * Reads the existing fills, sorts by frequency, and remaps to the
 * supplied palette (truncated/padded as needed). Returns a new SVG.
 *
 * Useful for palette variants: 1 composition × 5 colorways = 5 SKUs.
 */
export function recolorSvg(svg: string, palette: string[]): string {
  if (palette.length === 0) return svg

  // Find all distinct fill colors used in the SVG (rough regex; vtracer
  // outputs `fill="#rrggbb"` patterns reliably).
  const fills = new Map<string, number>()
  const re = /fill="(#[0-9a-fA-F]{6})"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(svg)) !== null) {
    const c = match[1].toLowerCase()
    fills.set(c, (fills.get(c) ?? 0) + 1)
  }

  const sortedColors = [...fills.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color)

  const remap = new Map<string, string>()
  sortedColors.forEach((color, idx) => {
    remap.set(color, palette[idx % palette.length].toLowerCase())
  })

  return svg.replace(/fill="(#[0-9a-fA-F]{6})"/g, (_, color) => {
    const lower = color.toLowerCase()
    return `fill="${remap.get(lower) ?? lower}"`
  })
}

function countColorBands(svg: string): number {
  const fills = new Set<string>()
  const re = /fill="#[0-9a-fA-F]{6}"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(svg)) !== null) {
    fills.add(match[0])
  }
  return fills.size
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
