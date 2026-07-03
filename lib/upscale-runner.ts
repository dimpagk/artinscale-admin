/**
 * Upscale runner — the same logic that lives in
 * `/api/art-generator/[id]/upscale`, lifted into a library function so
 * it's callable from server actions, agents, and crons without an HTTP
 * round-trip (which would lose auth context anyway).
 *
 * Idempotent: if `metadata.upscaledImageUrl` is already set on the
 * generated_images row, returns early with `{ alreadyUpscaled: true }`.
 *
 * Why this matters for automation: the print-safety guardrail in
 * `pushToGelatoAction` rejects images smaller than the template's
 * minimum print-safe dimensions. Gemini hands us 1024×1024; that's
 * fine for the storefront preview but fails for any real print size.
 * Auto-upscaling on artwork creation removes a manual click.
 */
import crypto from 'node:crypto';
import sharp from 'sharp';
import { upscaleImage } from './upscaler';
import { uploadFile, getPublicUrl } from './storage';
import { supabaseAdmin } from './supabase/admin';
import { fetchImageDimensions, extensionForMime } from './image-dimensions';
import { planUpscaleForBase, planUpscaleForTarget, dpiForPrint } from './gelato-templates';

export interface UpscaleRunResult {
  generatedImageId: string;
  upscaledImageUrl: string;
  scale: number;
  dimensions: { width: number; height: number } | null;
  /** The product size the master was sized for (null when auto-planned). */
  productType: string | null;
  /** Effective print DPI at that size (null when unknown). 300 is the goal. */
  dpi: number | null;
  alreadyUpscaled: boolean;
  isDryRun: boolean;
}

/**
 * Look up the generated_images row whose `image_url` matches the given
 * artwork.image_url. Returns null when the artwork's image isn't
 * tracked (e.g. it was uploaded directly without going through the
 * generator).
 */
export async function findGeneratedImageForArtworkUrl(
  imageUrl: string
): Promise<{
  id: string;
  storage_path: string;
  metadata: Record<string, unknown> | null;
} | null> {
  const { data } = await supabaseAdmin
    .from('generated_images')
    .select('id, storage_path, metadata')
    .eq('image_url', imageUrl)
    .maybeSingle();
  return data ?? null;
}

/**
 * Upscale a generated image and persist the result on its metadata.
 *
 * Mirrors `app/api/art-generator/[id]/upscale/route.ts` line-for-line —
 * the route stays for operator manual overrides, this function is for
 * programmatic callers.
 */
export async function runUpscaleForGeneratedImage(args: {
  generatedImageId: string;
  /**
   * Size the master for this exact product (operator-chosen). Aims for
   * 300 DPI at that size. Omit to auto-plan the largest size the base can
   * reach (<= 50×70): the behavior the push-to-Gelato auto path uses.
   */
  targetProductType?: string;
}): Promise<UpscaleRunResult> {
  const { generatedImageId, targetProductType } = args;

  const { data: image } = await supabaseAdmin
    .from('generated_images')
    .select('id, image_url, storage_path, metadata')
    .eq('id', generatedImageId)
    .single();
  if (!image) {
    throw new Error(`generated_images row not found: ${generatedImageId}`);
  }

  const meta = (image.metadata ?? {}) as Record<string, unknown>;
  const existingUrl = meta.upscaledImageUrl;
  // Reuse the cached master only when it already targets the requested
  // size. If the operator picks a different size, re-run so the master
  // matches it (and hits 300 DPI for it).
  const cachedForRequest =
    typeof existingUrl === 'string' &&
    existingUrl.length > 0 &&
    (!targetProductType || meta.upscaledProductType === targetProductType);
  if (cachedForRequest) {
    const dims = (meta.upscaledDimensions as { width: number; height: number } | undefined) ?? null;
    return {
      generatedImageId,
      upscaledImageUrl: existingUrl as string,
      scale: (meta.upscaledScale as number) ?? 1,
      dimensions: dims,
      productType: (meta.upscaledProductType as string) ?? null,
      dpi: (meta.upscaledDpi as number) ?? null,
      alreadyUpscaled: true,
      isDryRun: meta.upscaledIsDryRun === true,
    };
  }

  // Plan from the base image's actual resolution: how far to go and how,
  // to hit 300 DPI for the largest size it can reach. Mild jumps (a real
  // 4K base → 50×70) are a faithful in-process resize; big jumps from a
  // small base use Clarity. When we can't measure the base, don't guess —
  // keep the original as the master (print-safety still gates the push).
  const base = await fetchImageDimensions(image.image_url);
  const plan = base
    ? targetProductType
      ? planUpscaleForTarget(base.width, base.height, targetProductType)
      : planUpscaleForBase(base.width, base.height)
    : null;

  if (!base || !plan || plan.method === 'none') {
    const dims = base ? { width: base.width, height: base.height } : null;
    const dpi =
      dims && plan ? dpiForPrint(dims.width, dims.height, plan.productType) : null;
    await supabaseAdmin
      .from('generated_images')
      .update({
        metadata: {
          ...meta,
          upscaledImageUrl: image.image_url,
          upscaledScale: 1,
          upscaledMethod: 'none',
          upscaledProductType: plan?.productType ?? null,
          upscaledDpi: dpi,
          upscaledDimensions: dims,
          upscaledAt: new Date().toISOString(),
          upscaledIsDryRun: false,
        },
      })
      .eq('id', generatedImageId);
    return {
      generatedImageId,
      upscaledImageUrl: image.image_url,
      scale: 1,
      dimensions: dims,
      productType: plan?.productType ?? null,
      dpi,
      alreadyUpscaled: false,
      isDryRun: false,
    };
  }

  // Produce the print master.
  let buffer: Buffer;
  let isDryRun = false;
  if (plan.method === 'resize') {
    // Faithful Lanczos upsample to cover the target print px (fit:'outside'
    // preserves aspect; Gelato crops to the exact poster ratio at print).
    const src = await fetch(image.image_url);
    if (!src.ok) throw new Error(`Could not fetch base image for resize: ${src.status}`);
    buffer = await sharp(Buffer.from(await src.arrayBuffer()))
      .resize({
        width: plan.targetWidthPx,
        height: plan.targetHeightPx,
        fit: 'outside',
        withoutEnlargement: false,
        kernel: 'lanczos3',
      })
      .jpeg({ quality: 95 })
      .toBuffer();
  } else {
    const out = await upscaleImage({ imageUrl: image.image_url, model: 'clarity', scale: plan.scale });
    buffer = out.buffer;
    isDryRun = out.isDryRun ?? false;
  }

  const originalName = image.storage_path.split('/').pop() ?? `${generatedImageId}.jpg`;
  const baseName = originalName.replace(/\.[a-z0-9]+$/i, '');
  const ext = plan.method === 'resize' ? 'jpg' : extensionForMime(isDryRun ? undefined : 'image/png');
  const upscaledPath = `upscaled/${baseName}-${plan.method}-${crypto
    .randomBytes(3)
    .toString('hex')}.${ext}`;

  await uploadFile('ai-generated', upscaledPath, buffer, {
    contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
  });
  const upscaledImageUrl = getPublicUrl('ai-generated', upscaledPath);
  const dims = await fetchImageDimensions(upscaledImageUrl);
  const dpi = dims ? dpiForPrint(dims.width, dims.height, plan.productType) : null;

  await supabaseAdmin
    .from('generated_images')
    .update({
      metadata: {
        ...meta,
        upscaledImageUrl,
        upscaledStoragePath: upscaledPath,
        upscaledScale: plan.method === 'clarity' ? plan.scale : plan.factor,
        upscaledMethod: plan.method,
        upscaledProductType: plan.productType,
        upscaledDpi: dpi,
        upscaledDimensions: dims ? { width: dims.width, height: dims.height } : null,
        upscaledAt: new Date().toISOString(),
        upscaledIsDryRun: isDryRun,
      },
    })
    .eq('id', generatedImageId);

  return {
    generatedImageId,
    upscaledImageUrl,
    scale: plan.method === 'clarity' ? plan.scale : plan.factor,
    dimensions: dims,
    productType: plan.productType,
    dpi,
    alreadyUpscaled: false,
    isDryRun,
  };
}

/**
 * Convenience wrapper: given an artwork's `image_url`, find the
 * matching generated_images row (if any) and ensure it has an
 * upscaled version. No-op when the URL doesn't match a generated row
 * (e.g. operator-uploaded artworks).
 */
export async function ensureUpscaledForArtworkImage(
  artworkImageUrl: string
): Promise<UpscaleRunResult | { skipped: true; reason: string }> {
  const row = await findGeneratedImageForArtworkUrl(artworkImageUrl);
  if (!row) {
    return { skipped: true, reason: 'no generated_images row matches artwork.image_url' };
  }
  return runUpscaleForGeneratedImage({ generatedImageId: row.id });
}
