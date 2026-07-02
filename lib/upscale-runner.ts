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
import { upscaleImage } from './upscaler';
import { uploadFile, getPublicUrl } from './storage';
import { supabaseAdmin } from './supabase/admin';
import { fetchImageDimensions, extensionForMime } from './image-dimensions';
import { planUpscaleForBase } from './gelato-templates';

export interface UpscaleRunResult {
  generatedImageId: string;
  upscaledImageUrl: string;
  scale: number;
  dimensions: { width: number; height: number } | null;
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
}): Promise<UpscaleRunResult> {
  const { generatedImageId } = args;

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
  if (typeof existingUrl === 'string' && existingUrl.length > 0) {
    const dims = (meta.upscaledDimensions as { width: number; height: number } | undefined) ?? null;
    return {
      generatedImageId,
      upscaledImageUrl: existingUrl,
      scale: (meta.upscaledScale as number) ?? 1,
      dimensions: dims,
      alreadyUpscaled: true,
      isDryRun: meta.upscaledIsDryRun === true,
    };
  }

  // Plan the upscale from the base image's actual resolution: how far do
  // we go, and with which upscaler, to hit 300 DPI for the largest size
  // this image can reach. Real-ESRGAN x2 for the small jumps, Clarity for
  // 60×90 / 70×100.
  const base = await fetchImageDimensions(image.image_url);
  const plan = base ? planUpscaleForBase(base.width, base.height) : null;

  // Base already prints at the target size (or we couldn't measure it and
  // fall through to Real-ESRGAN x2): when no upscale is needed, the
  // original IS the print master.
  if (base && plan && plan.model === null) {
    await supabaseAdmin
      .from('generated_images')
      .update({
        metadata: {
          ...meta,
          upscaledImageUrl: image.image_url,
          upscaledScale: 1,
          upscaledProductType: plan.productType,
          upscaledDimensions: { width: base.width, height: base.height },
          upscaledAt: new Date().toISOString(),
          upscaledIsDryRun: false,
        },
      })
      .eq('id', generatedImageId);
    return {
      generatedImageId,
      upscaledImageUrl: image.image_url,
      scale: 1,
      dimensions: { width: base.width, height: base.height },
      alreadyUpscaled: false,
      isDryRun: false,
    };
  }

  const { buffer, scale, model, isDryRun } = await upscaleImage({
    imageUrl: image.image_url,
    model: plan?.model ?? 'real-esrgan',
    scale: plan?.scale ?? 2,
  });

  const originalName = image.storage_path.split('/').pop() ?? `${generatedImageId}.png`;
  const baseName = originalName.replace(/\.[a-z0-9]+$/i, '');
  const ext = extensionForMime(isDryRun ? undefined : 'image/png');
  const upscaledPath = `upscaled/${baseName}-${model}-x${scale}-${crypto
    .randomBytes(3)
    .toString('hex')}.${ext}`;

  await uploadFile('ai-generated', upscaledPath, buffer, {
    contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
  });
  const upscaledImageUrl = getPublicUrl('ai-generated', upscaledPath);
  const dims = await fetchImageDimensions(upscaledImageUrl);

  await supabaseAdmin
    .from('generated_images')
    .update({
      metadata: {
        ...meta,
        upscaledImageUrl,
        upscaledStoragePath: upscaledPath,
        upscaledScale: scale,
        upscaledModel: model,
        upscaledProductType: plan?.productType ?? null,
        upscaledDimensions: dims ? { width: dims.width, height: dims.height } : null,
        upscaledAt: new Date().toISOString(),
        upscaledIsDryRun: isDryRun ?? false,
      },
    })
    .eq('id', generatedImageId);

  return {
    generatedImageId,
    upscaledImageUrl,
    scale,
    dimensions: dims,
    alreadyUpscaled: false,
    isDryRun: isDryRun ?? false,
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
