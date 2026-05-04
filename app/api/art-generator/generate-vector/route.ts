import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { generateVectorWithClaude } from '@/lib/agents/claude-vector-generator'
import { getStylePackAsync } from '@/lib/style-packs/server'
import { renderSvgToPng } from '@/lib/svg-render'
import { uploadFile, getPublicUrl } from '@/lib/storage'
import { createGeneratedImage } from '@/lib/generated-images'
import { tagVisualContent } from '@/lib/agents/visual-tagger'
import { updateGeneratedImage } from '@/lib/generated-images'
import { countLayers } from '@/lib/svg-layers'

/**
 * Direct vector generation. Claude writes SVG markup; we render a PNG
 * preview via sharp, then store both alongside a `generated_images` row.
 *
 * Output layout:
 *   - SVG  → ai-generated://YYYY/MM/<uuid>.svg          (the vector source of truth)
 *   - PNG  → ai-generated://YYYY/MM/<uuid>.preview.png  (for the gallery + Gelato push)
 *
 * The new row's `metadata.vector` is populated with the SVG as both
 * master AND a single starter variant — so the operator can immediately
 * open the Vector Studio's layer editor without having to "Vectorize"
 * (it's already a vector).
 */
export async function POST(request: Request) {
  let body: {
    stylePackId?: string
    subject?: string
    contributionContext?: string
    topicId?: string
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.stylePackId) {
    return NextResponse.json(
      { error: 'stylePackId is required for vector generation' },
      { status: 400 }
    )
  }
  if (!body.subject || !body.subject.trim()) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 })
  }

  const pack = await getStylePackAsync(body.stylePackId)
  if (!pack) {
    return NextResponse.json(
      { error: `Unknown style pack: ${body.stylePackId}` },
      { status: 404 }
    )
  }

  let claudeResult
  try {
    claudeResult = await generateVectorWithClaude({
      stylePack: pack,
      subject: body.subject,
      contributionContext: body.contributionContext,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Claude vector generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }

  // Render preview PNG so the gallery thumbnail + Gelato push paths
  // continue to work as if this were a raster generation.
  let previewPng
  try {
    previewPng = await renderSvgToPng({ svg: claudeResult.svg, width: 1024 })
  } catch (err) {
    return NextResponse.json(
      { error: `Could not render Claude SVG to PNG: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }

  // Upload SVG + PNG
  const now = new Date()
  const yr = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const baseId = crypto.randomUUID()
  const svgPath = `${yr}/${mo}/${baseId}.svg`
  const pngPath = `${yr}/${mo}/${baseId}.preview.png`

  await uploadFile('ai-generated', svgPath, Buffer.from(claudeResult.svg), {
    contentType: 'image/svg+xml',
  })
  await uploadFile('ai-generated', pngPath, previewPng.buffer, {
    contentType: 'image/png',
  })
  const svgUrl = getPublicUrl('ai-generated', svgPath)
  const pngUrl = getPublicUrl('ai-generated', pngPath)

  // Create the generated_images row. metadata.vector is pre-populated:
  // the Claude SVG IS the master, and we add it as a single variant
  // ("Original") so the Vector Studio shows it immediately without
  // requiring a separate "Vectorize" round-trip.
  const layerCount = countLayers(claudeResult.svg)
  const inserted = await createGeneratedImage({
    prompt: body.subject,
    edit_history: [],
    model: 'claude-vector',
    aspect_ratio: '1:1',
    style_preset: null,
    image_url: pngUrl,
    storage_path: pngPath,
    topic_id: body.topicId ?? null,
    artwork_id: null,
    metadata: {
      fullPrompt: `Direct vector via Claude: ${body.subject}`,
      contributionContext: body.contributionContext || null,
      stylePackId: pack.id,
      stylePackPersonaUserId: pack.persona.userId,
      isNativeSvg: true,
      nativeVectorUrl: svgUrl,
      nativeVectorStoragePath: svgPath,
      paletteUsed: claudeResult.paletteUsed,
      measuredDimensions: { width: previewPng.width, height: previewPng.height },
      // Cost ledger: ~$0.05 for Claude Opus 4.7 large output + ~$0.01
      // for the post-gen tagger
      estimatedCostUsd: 0.06,
      // Pre-populated vector metadata so the Vector Studio shows it
      // without needing a separate "Vectorize" step
      vector: {
        masterSvgUrl: svgUrl,
        masterStoragePath: svgPath,
        colorBandCount: layerCount,
        variants: [
          {
            paletteName: 'Original (Claude native)',
            paletteHex: claudeResult.paletteUsed,
            svgUrl,
            svgStoragePath: svgPath,
          },
        ],
        vectorizedAt: new Date().toISOString(),
        isDryRun: false,
      },
    },
  })
  if (!inserted) {
    return NextResponse.json(
      { error: 'Could not save generated_images row' },
      { status: 500 }
    )
  }

  // Background tagger — same fire-and-forget pattern as the raster route
  void (async () => {
    try {
      const tags = await tagVisualContent({ imageUrl: pngUrl })
      await updateGeneratedImage(inserted.id, {
        metadata: { ...(inserted.metadata ?? {}), tags },
      })
    } catch {
      /* non-fatal */
    }
  })()

  return NextResponse.json({ image: inserted, layerCount })
}
