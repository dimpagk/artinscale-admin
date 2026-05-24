/**
 * Per-artwork mockup composer.
 *
 * Produces the 6-image set every product needs:
 *   1. Original art piece                    (just the source image)
 *   2-4. Three zoomed-in detail crops        (deterministic smart crops)
 *   5. Framed close-up                       (Gemini edit)
 *   6. In-room shot at scale                 (Gemini edit, on a pre-generated scene)
 *
 * Detail crops are pixel-real — no AI. The framed and in-room shots
 * are AI composites because we don't have a clean way to overlay onto
 * a real frame/wall photo with correct perspective and lighting at
 * print quality. Gemini's image-edit model handles this well enough for
 * marketing imagery; we hold these to "sells the product" quality, not
 * "print-safe" quality.
 *
 * Usage from a route handler:
 *
 *   const result = await composeArtworkMockups({
 *     artworkId, sourceImageUrl, productType, stylePackId
 *   })
 *   // result.image_urls = { original, details: [...], framed, inRoom }
 *
 * Idempotent: skips any image whose storage object already exists.
 */

import crypto from 'node:crypto';
import sharp from 'sharp';
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import { supabaseAdmin } from './supabase/admin';
import { getTemplateConfig, type RoomType } from './gelato-templates';
import {
  pickSceneForRoom,
  sceneStoragePath,
  MOCKUP_SCENES_BUCKET,
  type MockupScene,
} from './mockup-scenes';

const STORAGE_BUCKET = 'ai-generated';
const MOCKUP_PREFIX = 'mockups';

const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

export interface MockupSet {
  original: string;
  details: [string, string, string];
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

  // 2-4: Detail crops (server-side, deterministic)
  const detailUrls: string[] = [];
  for (let i = 0; i < 3; i++) {
    const key = mockupKey(args.artworkId, `detail-${i + 1}`);
    const path = `${MOCKUP_PREFIX}/${key}.jpg`;
    if (!args.force && (await storageObjectExists(path))) {
      detailUrls.push(publicUrl(path));
      continue;
    }
    try {
      const cropBuf = await renderDetailCrop(sourceBuf, sourceMeta, i);
      await uploadBuffer(path, cropBuf, 'image/jpeg');
      detailUrls.push(publicUrl(path));
      generated.details++;
    } catch (e) {
      errors.push(`detail-${i + 1}: ${msg(e)}`);
      detailUrls.push(args.sourceImageUrl); // fallback to original so the set is never short
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
        const buf = await generateFramedComposite(sourceBuf, config);
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
    const scene = pickRoomSceneForArtwork(args.artworkId, config.recommendedRooms[0], args.aestheticHint);
    const path = `${MOCKUP_PREFIX}/${mockupKey(args.artworkId, `in-room-${scene.key}`)}.png`;
    if (!args.force && (await storageObjectExists(path))) {
      inRoomUrl = publicUrl(path);
    } else {
      try {
        const sceneBuf = await fetchSceneBuffer(scene.key);
        const buf = await generateInRoomComposite(sourceBuf, sceneBuf, scene, config);
        await uploadBuffer(path, buf, 'image/png');
        inRoomUrl = publicUrl(path);
        generated.inRoom = true;
      } catch (e) {
        errors.push(`in-room (${scene.key}): ${msg(e)}`);
      }
    }
  }

  return {
    artworkId: args.artworkId,
    productType: args.productType,
    imageUrls: {
      original: args.sourceImageUrl,
      details: [detailUrls[0], detailUrls[1], detailUrls[2]],
      framed: framedUrl,
      inRoom: inRoomUrl,
    },
    generated,
    errors,
  };
}

// ============================================
// Detail crop — deterministic, no AI
// ============================================

/**
 * Three crops with different intents:
 *   #0 — Center-weighted close-up at ~40% of source (pure subject).
 *   #1 — Top-third detail at ~30% (composition / texture in upper edge).
 *   #2 — Bottom-third detail at ~30% (signature / detail in lower edge).
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
    referenceImages: [{ buffer: artworkBuf, mimeType: 'image/png' }],
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
      { buffer: artworkBuf, mimeType: 'image/png' },
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
  const client = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = client.getGenerativeModel({ model: GEMINI_IMAGE_MODEL });

  const parts: Part[] = [];
  for (const ref of args.referenceImages) {
    parts.push({
      inlineData: { mimeType: ref.mimeType, data: ref.buffer.toString('base64') },
    });
  }
  parts.push({ text: args.prompt });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
  });

  const responseParts = result.response?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((p) => p.inlineData);
  if (!imagePart?.inlineData) {
    throw new Error('Gemini returned no image inlineData');
  }
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// ============================================
// Scene helpers
// ============================================

function pickRoomSceneForArtwork(
  artworkId: string,
  room: RoomType,
  aestheticHint?: MockupScene['aesthetic']
): MockupScene {
  return pickSceneForRoom(room, artworkId, aestheticHint);
}

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
