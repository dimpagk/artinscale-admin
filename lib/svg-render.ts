/**
 * Server-side SVG → high-resolution PNG rendering via sharp.
 *
 * The vectorize endpoint produces master + palette-variant SVGs. Gelato
 * (and Shopify product imagery) expects raster PNGs at print resolution.
 * This module bridges the two: take an SVG string, render to a PNG
 * buffer at the requested pixel size.
 *
 * sharp uses libvips internally — fast, no headless browser, no
 * Replicate cost. Requires the `sharp` npm package, installed in
 * admin's dependencies.
 *
 * Why server-side: the canvas/DOM-based rendering (the existing
 * post-canvas-export flow) only works in the browser. Vectorize is a
 * server flow — we can't ask the browser to do this.
 */

import sharp from 'sharp'

export interface RenderSvgArgs {
  svg: string
  /** Target width in pixels (long side). Defaults to 4096 for poster-print quality. */
  width?: number
  /** Optional background — useful for opaque PNG output. SVG transparency by default. */
  background?: { r: number; g: number; b: number; alpha?: number }
}

export interface RenderSvgResult {
  buffer: Buffer
  width: number
  height: number
}

const DEFAULT_WIDTH = 4096

export async function renderSvgToPng(args: RenderSvgArgs): Promise<RenderSvgResult> {
  const targetWidth = args.width ?? DEFAULT_WIDTH

  const svgBuffer = Buffer.from(args.svg, 'utf8')

  // Density math: sharp's `density` controls SVG rasterization DPI.
  // sharp defaults to 72 DPI. To get a wider raster we either bump
  // density or scale after raster. Density is cleaner but requires
  // knowing the SVG's native viewport. Fortunately sharp can read the
  // SVG metadata to figure that out.
  const meta = await sharp(svgBuffer).metadata()
  const nativeWidth = meta.width ?? 1024
  const scaleFactor = targetWidth / nativeWidth
  const density = Math.min(2400, Math.max(72, Math.round(72 * scaleFactor)))

  let pipeline = sharp(svgBuffer, { density }).resize({
    width: targetWidth,
    fit: 'inside',
    withoutEnlargement: false,
  })

  if (args.background) {
    pipeline = pipeline.flatten({
      background: { r: args.background.r, g: args.background.g, b: args.background.b, alpha: args.background.alpha ?? 1 },
    })
  }

  const output = await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })

  return {
    buffer: output.data,
    width: output.info.width,
    height: output.info.height,
  }
}
