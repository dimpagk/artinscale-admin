/**
 * Replicate-based image upscaler.
 *
 * Takes a 1024-ish-px Gemini output and produces a 4x upscale (~4096px)
 * suitable for poster prints at 300 DPI. The default model is
 * Real-ESRGAN (`nightmareai/real-esrgan`) — a well-tested, fast,
 * well-priced upscaler that handles AI-generated content cleanly.
 *
 * Required env:
 *   - REPLICATE_API_TOKEN
 *   - UPSCALER_DRY_RUN=true   for local dev without a Replicate account
 *   - REPLICATE_UPSCALER_MODEL_VERSION (optional override)
 *
 * Cost: ~$0.005 per call at 4x. Nothing relative to Gemini's $0.04.
 *
 * Output: a buffer of the upscaled PNG. Caller is responsible for
 * uploading to Storage and updating the relevant row.
 */

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN
const DRY_RUN = process.env.UPSCALER_DRY_RUN === 'true'

/**
 * Replicate's newer "official model" endpoint resolves the latest
 * version automatically — no SHA-pinning required. Falls back to the
 * legacy versioned `/v1/predictions` if `REPLICATE_UPSCALER_MODEL_VERSION`
 * is set explicitly (lets the operator pin a specific SHA if desired).
 */
const MODEL_OWNER = 'nightmareai'
const MODEL_NAME = 'real-esrgan'
const MODEL_VERSION = process.env.REPLICATE_UPSCALER_MODEL_VERSION ?? null

// Clarity handles the big jumps (60×90 / 70×100) Real-ESRGAN's integer
// x2/x4 + ~128MP cap can't: arbitrary scale_factor, tiles to print
// resolution. Faithful settings (low creativity, high resemblance) keep
// it true to the source rather than inventing detail.
const CLARITY_OWNER = 'philz1337x'
const CLARITY_NAME = 'clarity-upscaler'
// Community models (unlike official ones such as real-esrgan) have no
// `/models/{owner}/{name}/predictions` endpoint — they must be run via
// `/v1/predictions` with a pinned version SHA. Pin via env, else resolve
// the latest at call time.
const CLARITY_VERSION = process.env.REPLICATE_CLARITY_MODEL_VERSION ?? null

export type UpscaleModel = 'real-esrgan' | 'clarity'

export interface UpscaleArgs {
  imageUrl: string
  /** Upscale ratio. Real-ESRGAN accepts 2 or 4; Clarity takes any value. */
  scale?: number
  /** Which upscaler. Default Real-ESRGAN (cheap/fast/faithful). */
  model?: UpscaleModel
  /** Whether to run face enhancement (Real-ESRGAN only; off — we do flat art) */
  faceEnhance?: boolean
}

export interface UpscaleResult {
  buffer: Buffer
  /** Original → upscaled dimension ratio actually applied */
  scale: number
  model: UpscaleModel
  isDryRun?: boolean
}

export async function upscaleImage(args: UpscaleArgs): Promise<UpscaleResult> {
  const model: UpscaleModel = args.model ?? 'real-esrgan'

  if (DRY_RUN) {
    console.log('[Upscaler] DRY RUN — would upscale:', args.imageUrl)
    // Fetch the original and return it as-is — operator can wire real
    // upscaling later, the rest of the pipeline still flows.
    const res = await fetch(args.imageUrl)
    if (!res.ok) {
      throw new Error(`DRY RUN: could not fetch original (${res.status})`)
    }
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      scale: 1,
      model,
      isDryRun: true,
    }
  }

  if (!REPLICATE_API_TOKEN) {
    throw new Error(
      'REPLICATE_API_TOKEN missing. Set UPSCALER_DRY_RUN=true to passthrough the original for testing.'
    )
  }

  const { url, body, timeoutMs } = await buildRequest(model, args)

  const startRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!startRes.ok) {
    throw new Error(`Replicate start error ${startRes.status}: ${await startRes.text()}`)
  }
  const started = (await startRes.json()) as { id: string; urls: { get: string } }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const pollRes = await fetch(started.urls.get, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    })
    if (!pollRes.ok) {
      throw new Error(`Replicate poll error ${pollRes.status}: ${await pollRes.text()}`)
    }
    const polled = (await pollRes.json()) as {
      status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
      // Real-ESRGAN returns a single URL; Clarity returns an array.
      output?: string | string[]
      error?: string
    }
    if (polled.status === 'succeeded') {
      const outputUrl = Array.isArray(polled.output) ? polled.output[0] : polled.output
      if (!outputUrl) throw new Error('Replicate succeeded but no output URL')
      const dl = await fetch(outputUrl)
      if (!dl.ok) throw new Error(`Failed to download upscaled image: ${dl.status}`)
      return {
        buffer: Buffer.from(await dl.arrayBuffer()),
        scale: args.scale ?? (model === 'real-esrgan' ? 2 : 1),
        model,
      }
    }
    if (polled.status === 'failed' || polled.status === 'canceled') {
      throw new Error(`Replicate ${polled.status}: ${polled.error ?? 'no detail'}`)
    }
  }
  throw new Error(`Replicate upscale (${model}) timed out after ${timeoutMs / 1000}s`)
}

async function buildRequest(
  model: UpscaleModel,
  args: UpscaleArgs
): Promise<{ url: string; body: Record<string, unknown>; timeoutMs: number }> {
  if (model === 'clarity') {
    const version = CLARITY_VERSION ?? (await resolveLatestVersion(CLARITY_OWNER, CLARITY_NAME))
    return {
      url: 'https://api.replicate.com/v1/predictions',
      body: {
        version,
        input: {
          image: args.imageUrl,
          scale_factor: args.scale ?? 2,
          // Faithful, not creative — this is reproduction, not reimagining.
          creativity: 0.25,
          resemblance: 1.2,
          output_format: 'png',
        },
      },
      // Clarity is SD-based and tiles large outputs — much slower than ESRGAN.
      timeoutMs: 240_000,
    }
  }

  // Real-ESRGAN — integer scale only (2 or 4).
  const esrganScale = args.scale === 4 ? 4 : 2
  const url = MODEL_VERSION
    ? 'https://api.replicate.com/v1/predictions'
    : `https://api.replicate.com/v1/models/${MODEL_OWNER}/${MODEL_NAME}/predictions`
  const input = {
    image: args.imageUrl,
    scale: esrganScale,
    face_enhance: args.faceEnhance ?? false,
  }
  return {
    url,
    body: MODEL_VERSION ? { version: MODEL_VERSION, input } : { input },
    timeoutMs: 120_000,
  }
}

/** Resolve a community model's latest version SHA for `/v1/predictions`. */
async function resolveLatestVersion(owner: string, name: string): Promise<string> {
  const res = await fetch(`https://api.replicate.com/v1/models/${owner}/${name}`, {
    headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
  })
  if (!res.ok) {
    throw new Error(`Replicate model lookup failed for ${owner}/${name}: ${res.status}`)
  }
  const data = (await res.json()) as { latest_version?: { id?: string } }
  const id = data.latest_version?.id
  if (!id) throw new Error(`No latest version for ${owner}/${name}`)
  return id
}
