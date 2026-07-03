/**
 * Per-artwork mockup composer.
 *
 * Produces the 5-image set every product needs:
 *   1. Original art piece                    (just the source image)
 *   2-3. Two zoomed-in detail crops          (content-aware, Gemini-picked focal regions)
 *   4. Framed close-up                       (Gemini edit)
 *   5. In-room shot at scale                 (Gemini edit, on a pre-generated scene)
 *
 * Detail crops are pixel-real: a cheap Gemini vision call picks the two
 * most interesting elements of the artwork, then sharp crops exactly
 * those regions (geometric crops as fallback when vision fails). The
 * framed and in-room shots are AI composites because we don't have a
 * clean way to overlay onto a real frame/wall photo with correct
 * perspective and lighting at print quality. Gemini's image-edit model
 * handles this well enough for marketing imagery; we hold these to
 * "sells the product" quality, not "print-safe" quality.
 *
 * Usage from a route handler:
 *
 *   const result = await composeArtworkMockups({
 *     artworkId, sourceImageUrl, productType, stylePackId
 *   })
 *   // result.imageUrls = { original, details: [...], framed, inRoom }
 *
 * Idempotent: skips any image whose storage object already exists. On
 * completion the set is also persisted to artworks.mockup_urls so the
 * admin page and storefront can read it without digging through
 * agent_tasks output (no-op until migration 031 adds the column).
 */

import crypto from 'node:crypto';
import sharp from 'sharp';
import { GoogleGenAI, type Part } from '@google/genai';
import { supabaseAdmin } from './supabase/admin';
import { getTemplateConfig } from './gelato-templates';
import {
  pickSceneForRooms,
  sceneStoragePath,
  MOCKUP_SCENES_BUCKET,
  type MockupScene,
} from './mockup-scenes';

const STORAGE_BUCKET = 'ai-generated';
const MOCKUP_PREFIX = 'mockups';

const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
// Image-edit composites (framed + in-room). Nano Banana 2, verified on this key.
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
// Cheap vision call that picks the focal regions for the detail crops.
// Same text model the contribution clusterer already uses.
const GEMINI_VISION_MODEL = 'gemini-2.5-flash';

// Hard ceiling for any single Gemini call. A standalone probe returned a
// valid image in ~24s even from a full 10 MB source, so 60s is a safe
// upper bound. Past it the request has stalled; we fail fast rather than
// let the mockup-composer task hang in `running` state indefinitely.
const GEMINI_CALL_TIMEOUT_MS = 60_000;

/**
 * Reject with a clear error if `promise` has not settled within `ms`. The
 * underlying Gemini request may still be in flight, but the composer's
 * try/catch records the timeout in the task's error list and fails fast.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface MockupSet {
  original: string;
  details: [string, string];
  framed: string;
  inRoom: string;
}

export interface ComposeArgs {
  artworkId: string;
  sourceImageUrl: string;
  productType: string;
  /** Optional aesthetic to bias scene selection */
  aestheticHint?: MockupScene['aesthetic'];
  /** If true, regenerate everything even if it exists */
  force?: boolean;
}

export interface ComposeResult {
  artworkId: string;
  productType: string;
  imageUrls: MockupSet;
  generated: { details: number; framed: boolean; inRoom: boolean };
  errors: string[];
}

// ============================================
// Public entry point
// ============================================

export async function composeArtworkMockups(args: ComposeArgs): Promise<ComposeResult> {
  const config = getTemplateConfig(args.productType);
  if (!config) {
    throw new Error(`Unknown product type: ${args.productType}`);
  }

  const errors: string[] = [];
  const generated = { details: 0, framed: false, inRoom: false };

  // Fetch source image once and reuse buffers/metadata across steps
  const sourceBuf = await fetchImage(args.sourceImageUrl);
  const sourceMeta = await sharp(sourceBuf).metadata();
  if (!sourceMeta.width || !sourceMeta.height) {
    throw new Error('Could not read source image dimensions');
  }

  // Downscaled copy (~1 MB) for the Gemini reference images. The vision and
  // composite calls only need a display-resolution preview, not the full
  // print master — a 10 MB source base64-encodes to ~13.6 MB per request,
  // which is slow and needlessly heavy. The detail zoom-crops below keep
  // using the full-resolution `sourceBuf` so they stay crisp.
  const geminiRefBuf = await downscaleForGemini(sourceBuf);

  // 2-3: Detail crops (content-aware, geometric fallback)
  const detailUrls: string[] = [];
  const detailPaths = [1, 2].map(
    (n) => `${MOCKUP_PREFIX}/${mockupKey(args.artworkId, `detail-${n}`)}.jpg`
  );
  const detailsCached =
    !args.force &&
    (await storageObjectExists(detailPaths[0])) &&
    (await storageObjectExists(detailPaths[1]));
  if (detailsCached) {
    detailUrls.push(publicUrl(detailPaths[0]), publicUrl(detailPaths[1]));
  } else {
    // One vision call picks the two most interesting elements; only spend
    // it when at least one crop actually needs rendering.
    let regions: FocalRegion[] | null = null;
    try {
      regions = await pickFocalRegions(geminiRefBuf);
    } catch (e) {
      errors.push(`focal-regions (fell back to geometric crops): ${msg(e)}`);
    }
    for (let i = 0; i < 2; i++) {
      const path = detailPaths[i];
      if (!args.force && (await storageObjectExists(path))) {
        detailUrls.push(publicUrl(path));
        continue;
      }
      try {
        const cropBuf = regions?.[i]
          ? await renderFocalCrop(sourceBuf, sourceMeta, regions[i])
          : await renderDetailCrop(sourceBuf, sourceMeta, i);
        await uploadBuffer(path, cropBuf, 'image/jpeg');
        detailUrls.push(publicUrl(path));
        generated.details++;
      } catch (e) {
        errors.push(`detail-${i + 1}: ${msg(e)}`);
        detailUrls.push(args.sourceImageUrl); // fallback to original so the set is never short
      }
    }
  }

  // 5: Framed close-up (AI composite)
  let framedUrl = args.sourceImageUrl;
  {
    const path = `${MOCKUP_PREFIX}/${mockupKey(args.artworkId, 'framed')}.png`;
    if (!args.force && (await storageObjectExists(path))) {
      framedUrl = publicUrl(path);
    } else {
      try {
        const buf = await generateFramedComposite(geminiRefBuf, config);
        await uploadBuffer(path, buf, 'image/png');
        framedUrl = publicUrl(path);
        generated.framed = true;
      } catch (e) {
        errors.push(`framed: ${msg(e)}`);
      }
    }
  }

  // 6: In-room composite at correct scale
  let inRoomUrl = framedUrl; // fallback to framed if scene compositing fails
  {
    // Rotate across ALL recommended rooms for this size (not just the
    // first), so the in-room shot uses the full scene library.
    const scene = pickSceneForRooms(config.recommendedRooms, args.artworkId, args.aestheticHint);
    const path = `${MOCKUP_PREFIX}/${mockupKey(args.artworkId, `in-room-${scene.key}`)}.png`;
    if (!args.force && (await storageObjectExists(path))) {
      inRoomUrl = publicUrl(path);
    } else {
      try {
        const sceneBuf = await fetchSceneBuffer(scene.key);
        const buf = await generateInRoomComposite(geminiRefBuf, sceneBuf, scene, config);
        await uploadBuffer(path, buf, 'image/png');
        inRoomUrl = publicUrl(path);
        generated.inRoom = true;
      } catch (e) {
        errors.push(`in-room (${scene.key}): ${msg(e)}`);
      }
    }
  }

  const imageUrls: MockupSet = {
    original: args.sourceImageUrl,
    details: [detailUrls[0], detailUrls[1]],
    framed: framedUrl,
    inRoom: inRoomUrl,
  };

  // Persist the set on the artwork row so the admin page (and later the
  // storefront) can read it directly. Best-effort: before migration 031
  // the column doesn't exist (42703) and we skip silently.
  try {
    const { error } = await supabaseAdmin
      .from('artworks')
      .update({
        mockup_urls: { ...imageUrls, composedAt: new Date().toISOString() },
      })
      .eq('id', args.artworkId);
    if (error && error.code !== '42703' && !/mockup_urls/.test(error.message)) {
      errors.push(`persist mockup_urls: ${error.message}`);
    }
  } catch (e) {
    errors.push(`persist mockup_urls: ${msg(e)}`);
  }

  return {
    artworkId: args.artworkId,
    productType: args.productType,
    imageUrls,
    generated,
    errors,
  };
}

// ============================================
// Detail crops
// ============================================

interface FocalRegion {
  /** Normalized [0..1] box around an interesting element */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/**
 * Ask Gemini vision for the two most visually interesting elements of the
 * artwork, as normalized bounding boxes. One cheap text-model call; any
 * parse/validation failure throws so the caller falls back to the
 * deterministic geometric crops.
 */
async function pickFocalRegions(sourceBuf: Buffer): Promise<FocalRegion[]> {
  if (!GEMINI_API_KEY) {
    throw new Error('GOOGLE_GEMINI_API_KEY missing');
  }
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const response = await withTimeout(
    ai.models.generateContent({
    model: GEMINI_VISION_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: sourceBuf.toString('base64') } },
          {
            text:
              'This is an art print. Identify the TWO most visually interesting, ' +
              'distinct elements a shopper would want to see up close (texture, a focal ' +
              'subject, a signature detail). Avoid empty background areas and avoid two ' +
              'boxes covering the same element. Reply with ONLY a JSON array of exactly 2 ' +
              'objects: [{"x":0-1,"y":0-1,"w":0-1,"h":0-1,"label":"short description"}]. ' +
              'Coordinates are normalized fractions of image width/height, box = top-left ' +
              'corner + size, each box covering roughly 25-45% of the image dimension.',
          },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
    }),
    GEMINI_CALL_TIMEOUT_MS,
    'Gemini vision (focal regions)'
  );

  const text = response.text;
  if (!text) throw new Error('Vision model returned no text');
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 2) {
    throw new Error('Vision model did not return 2 regions');
  }

  const regions: FocalRegion[] = [];
  for (const r of parsed.slice(0, 2)) {
    const box = r as Partial<FocalRegion>;
    if (
      typeof box.x !== 'number' ||
      typeof box.y !== 'number' ||
      typeof box.w !== 'number' ||
      typeof box.h !== 'number' ||
      box.w <= 0.05 ||
      box.h <= 0.05
    ) {
      throw new Error('Vision region failed validation');
    }
    regions.push({
      x: clamp01(box.x),
      y: clamp01(box.y),
      w: clamp01(box.w),
      h: clamp01(box.h),
      label: typeof box.label === 'string' ? box.label : 'detail',
    });
  }
  return regions;
}

/**
 * Crop a vision-picked focal region with sharp. The box is clamped to the
 * image bounds and gently padded (10% each side) so the element breathes;
 * output matches the geometric crops (JPEG 85, <=1600 px long side).
 */
async function renderFocalCrop(
  source: Buffer,
  meta: sharp.Metadata,
  region: FocalRegion
): Promise<Buffer> {
  const width = meta.width!;
  const height = meta.height!;

  const pad = 0.1;
  const x = clamp01(region.x - region.w * pad);
  const y = clamp01(region.y - region.h * pad);
  const w = Math.min(region.w * (1 + 2 * pad), 1 - x);
  const h = Math.min(region.h * (1 + 2 * pad), 1 - y);

  const left = Math.round(x * width);
  const top = Math.round(y * height);
  const cropW = Math.max(64, Math.round(w * width));
  const cropH = Math.max(64, Math.round(h * height));

  return sharp(source)
    .extract({
      left: Math.min(left, width - 64),
      top: Math.min(top, height - 64),
      width: Math.min(cropW, width - Math.min(left, width - 64)),
      height: Math.min(cropH, height - Math.min(top, height - 64)),
    })
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Geometric fallback crops, used when the vision pick fails:
 *   #0 — Center-weighted close-up at ~40% of source (pure subject).
 *   #1 — Upper-third detail at ~30% (composition / texture).
 *
 * All output JPEG quality 85, capped at 1600 px on the long side so
 * marketing images stay under ~400 KB while detail still reads.
 */
async function renderDetailCrop(
  source: Buffer,
  meta: sharp.Metadata,
  index: number
): Promise<Buffer> {
  const width = meta.width!;
  const height = meta.height!;

  let cropW: number;
  let cropH: number;
  let left: number;
  let top: number;

  if (index === 0) {
    // Center 40%
    cropW = Math.round(width * 0.4);
    cropH = Math.round(height * 0.4);
    left = Math.round((width - cropW) / 2);
    top = Math.round((height - cropH) / 2);
  } else if (index === 1) {
    // Upper-third 30% (offset from horizontal center for variety)
    cropW = Math.round(width * 0.3);
    cropH = Math.round(height * 0.3);
    left = Math.round(width * 0.3);
    top = Math.round(height * 0.1);
  } else {
    // Lower-third 30% (offset to other side)
    cropW = Math.round(width * 0.3);
    cropH = Math.round(height * 0.3);
    left = Math.round(width * 0.4);
    top = Math.round(height * 0.6);
  }

  return sharp(source)
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

// ============================================
// AI composites
// ============================================

async function generateFramedComposite(
  artworkBuf: Buffer,
  config: { aspectRatio: string; widthCm: number; heightCm: number }
): Promise<Buffer> {
  const prompt =
    'Take the artwork in the reference image and place it inside a thin solid-wood frame ' +
    '(natural light oak, ~1.5 cm wide, soft chamfer, no glass glare). The frame hangs centered ' +
    'on a clean off-white plaster wall, photographed straight-on at eye level. Soft natural ' +
    `daylight, no people, no objects on the wall besides the frame. Aspect ratio ${config.aspectRatio} portrait. ` +
    'Sharp focus on the artwork; the wall has a very slight ambient texture. ' +
    "Do NOT alter the artwork's content, color, or composition.";

  return geminiImageEdit({
    prompt,
    referenceImages: [{ buffer: artworkBuf, mimeType: 'image/jpeg' }],
  });
}

async function generateInRoomComposite(
  artworkBuf: Buffer,
  sceneBuf: Buffer,
  scene: MockupScene,
  config: { widthCm: number; heightCm: number; productFamily: string }
): Promise<Buffer> {
  const sizeBlurb = `${config.widthCm}×${config.heightCm} cm`;
  const prompt =
    `Take the room photo (first reference image) and place the artwork (second reference image) ` +
    `hanging on the empty wall in the scene, in a thin natural-oak frame, at the realistic ` +
    `scale of a ${sizeBlurb} poster relative to the furniture in the room. ` +
    `Center the artwork around the wall area roughly at coordinates ` +
    `(x=${(scene.wallTarget.x * 100).toFixed(0)}%, y=${(scene.wallTarget.y * 100).toFixed(0)}%) ` +
    `with width ~${(scene.wallTarget.w * 100).toFixed(0)}% of the photo width. ` +
    'Match the scene\'s lighting and shadow direction so the frame casts a believable soft shadow. ' +
    "Do NOT change the room scene's furniture, walls, or lighting. Do NOT alter the artwork's content. " +
    'Return a single photograph with the artwork composited in.';

  return geminiImageEdit({
    prompt,
    referenceImages: [
      { buffer: sceneBuf, mimeType: 'image/png' },
      { buffer: artworkBuf, mimeType: 'image/jpeg' },
    ],
  });
}

interface GeminiEditArgs {
  prompt: string;
  referenceImages: Array<{ buffer: Buffer; mimeType: string }>;
}

async function geminiImageEdit(args: GeminiEditArgs): Promise<Buffer> {
  if (!GEMINI_API_KEY) {
    throw new Error('GOOGLE_GEMINI_API_KEY missing');
  }
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const parts: Part[] = [];
  for (const ref of args.referenceImages) {
    parts.push({
      inlineData: { mimeType: ref.mimeType, data: ref.buffer.toString('base64') },
    });
  }
  parts.push({ text: args.prompt });

  const response = await withTimeout(
    ai.models.generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: [{ role: 'user', parts }],
    }),
    GEMINI_CALL_TIMEOUT_MS,
    'Gemini image-edit'
  );

  const responseParts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((p) => p.inlineData);
  if (!imagePart?.inlineData?.data) {
    throw new Error('Gemini returned no image inlineData');
  }
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// ============================================
// Reference-image downscaling
// ============================================

// Longest edge (px) for the copy of the artwork sent to Gemini as a
// reference image. Gemini downsamples reference inputs internally anyway,
// so ~1568 px is ample for the vision + composite calls while keeping the
// JPEG well under ~1 MB (a full 3584x4800 print master is ~10 MB).
const GEMINI_REF_MAX_EDGE = 1568;

async function downscaleForGemini(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize({
      width: GEMINI_REF_MAX_EDGE,
      height: GEMINI_REF_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ============================================
// Scene helpers
// ============================================

async function fetchSceneBuffer(sceneKey: string): Promise<Buffer> {
  const path = sceneStoragePath(sceneKey);
  const url = publicUrlFor(MOCKUP_SCENES_BUCKET, path);
  return fetchImage(url);
}

// ============================================
// Storage / IO
// ============================================

function mockupKey(artworkId: string, kind: string): string {
  // Hash artwork id so storage paths don't accidentally surface UUIDs
  const h = crypto.createHash('sha1').update(artworkId).digest('hex').slice(0, 12);
  return `${h}-${kind}`;
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function storageObjectExists(path: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .list(dirname(path), { search: basename(path) });
  if (error) return false;
  return data?.some((f) => f.name === basename(path)) ?? false;
}

async function uploadBuffer(path: string, buf: Buffer, contentType: string) {
  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(path, buf, { contentType, upsert: true });
  if (error) throw new Error(`Upload ${path} failed: ${error.message}`);
}

function publicUrl(path: string): string {
  return publicUrlFor(STORAGE_BUCKET, path);
}

function publicUrlFor(bucket: string, path: string): string {
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
