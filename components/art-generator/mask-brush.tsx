'use client'

import { useEffect, useRef, useState } from 'react'
import { Eraser, PaintBrush } from '@phosphor-icons/react'

/**
 * Mask brush overlay for inpainting.
 *
 * Renders a transparent canvas the same size as the underlying image.
 * The operator brushes white onto the canvas; on submit we serialize
 * the canvas as a PNG and send it alongside the source image to the
 * edit endpoint, with an instruction telling Gemini to "only modify
 * the regions covered by the mask."
 *
 * The display canvas shows the brush as semi-transparent magenta so
 * the operator sees their selection. The output canvas (used to build
 * the actual mask sent to Gemini) is pure white-on-black for max
 * model legibility.
 */

interface MaskBrushProps {
  imageUrl: string
  /**
   * Called with a base64-encoded PNG of the mask (white = edit, black =
   * keep), without the data URL prefix.
   */
  onMaskReady: (maskBase64: string | null) => void
}

const DEFAULT_BRUSH = 32
const MAX_DISPLAY_DIM = 600

export function MaskBrush({ imageUrl, onMaskReady }: MaskBrushProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH)
  const [tool, setTool] = useState<'paint' | 'erase'>('paint')
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasMask, setHasMask] = useState(false)
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null)

  // Fit display canvas inside MAX_DISPLAY_DIM (preserve aspect ratio).
  // Mask canvas matches IMAGE native dimensions so the mask we send is
  // pixel-aligned with what Gemini sees.
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImageDims({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.src = imageUrl
  }, [imageUrl])

  const displaySize = (() => {
    if (!imageDims) return { w: MAX_DISPLAY_DIM, h: MAX_DISPLAY_DIM }
    const aspect = imageDims.w / imageDims.h
    if (imageDims.w > imageDims.h) {
      return { w: MAX_DISPLAY_DIM, h: Math.round(MAX_DISPLAY_DIM / aspect) }
    }
    return { w: Math.round(MAX_DISPLAY_DIM * aspect), h: MAX_DISPLAY_DIM }
  })()

  const ratio = imageDims ? imageDims.w / displaySize.w : 1

  const drawAt = (clientX: number, clientY: number) => {
    if (!displayCanvasRef.current || !maskCanvasRef.current || !containerRef.current) return
    const rect = displayCanvasRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    const dCtx = displayCanvasRef.current.getContext('2d')
    const mCtx = maskCanvasRef.current.getContext('2d')
    if (!dCtx || !mCtx) return

    if (tool === 'paint') {
      // Display: semi-transparent magenta
      dCtx.fillStyle = 'rgba(236, 72, 153, 0.55)'
      dCtx.beginPath()
      dCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
      dCtx.fill()

      // Mask: pure white (matches the larger image dims)
      mCtx.fillStyle = 'white'
      mCtx.beginPath()
      mCtx.arc(x * ratio, y * ratio, (brushSize * ratio) / 2, 0, Math.PI * 2)
      mCtx.fill()
    } else {
      // Erase: clear both canvases at this position
      dCtx.save()
      dCtx.globalCompositeOperation = 'destination-out'
      dCtx.beginPath()
      dCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
      dCtx.fill()
      dCtx.restore()

      mCtx.save()
      mCtx.globalCompositeOperation = 'destination-out'
      mCtx.beginPath()
      mCtx.arc(x * ratio, y * ratio, (brushSize * ratio) / 2, 0, Math.PI * 2)
      mCtx.fill()
      mCtx.restore()
    }

    setHasMask(true)
  }

  const handleClear = () => {
    if (!displayCanvasRef.current || !maskCanvasRef.current) return
    displayCanvasRef.current.getContext('2d')?.clearRect(0, 0, displaySize.w, displaySize.h)
    if (imageDims) {
      const mCtx = maskCanvasRef.current.getContext('2d')
      // Reset mask: black background
      if (mCtx) {
        mCtx.fillStyle = 'black'
        mCtx.fillRect(0, 0, imageDims.w, imageDims.h)
      }
    }
    setHasMask(false)
    onMaskReady(null)
  }

  const finalize = () => {
    if (!maskCanvasRef.current || !hasMask) {
      onMaskReady(null)
      return
    }
    const dataUrl = maskCanvasRef.current.toDataURL('image/png')
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    onMaskReady(base64)
  }

  // Initialize mask canvas with black bg whenever image dims change
  useEffect(() => {
    if (!maskCanvasRef.current || !imageDims) return
    const ctx = maskCanvasRef.current.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, imageDims.w, imageDims.h)
  }, [imageDims])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setTool('paint')}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              tool === 'paint' ? 'bg-pink-100 text-pink-800' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <PaintBrush size={12} weight={tool === 'paint' ? 'fill' : 'regular'} />
            Paint
          </button>
          <button
            type="button"
            onClick={() => setTool('erase')}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              tool === 'erase' ? 'bg-pink-100 text-pink-800' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Eraser size={12} weight={tool === 'erase' ? 'fill' : 'regular'} />
            Erase
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-700">
          Brush
          <input
            type="range"
            min={8}
            max={120}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-32"
          />
          <span className="font-mono text-[10px] text-gray-500">{brushSize}px</span>
        </label>

        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-gray-500 underline-offset-2 hover:underline"
        >
          Clear mask
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative inline-block overflow-hidden rounded border border-gray-200 bg-gray-50"
        style={{ width: displaySize.w, height: displaySize.h }}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Mask base"
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <canvas
          ref={displayCanvasRef}
          width={displaySize.w}
          height={displaySize.h}
          className="absolute inset-0 cursor-crosshair touch-none"
          onMouseDown={(e) => {
            setIsDrawing(true)
            drawAt(e.clientX, e.clientY)
          }}
          onMouseMove={(e) => {
            if (isDrawing) drawAt(e.clientX, e.clientY)
          }}
          onMouseUp={() => {
            setIsDrawing(false)
            finalize()
          }}
          onMouseLeave={() => {
            if (isDrawing) {
              setIsDrawing(false)
              finalize()
            }
          }}
        />
        {/* Hidden mask canvas at native image resolution */}
        <canvas
          ref={maskCanvasRef}
          width={imageDims?.w ?? 1}
          height={imageDims?.h ?? 1}
          className="hidden"
        />
      </div>

      <p className="text-xs text-gray-500">
        Paint over the regions you want to change. The rest stays. Mask is sent
        alongside the prompt — Gemini honors masks well for line art and flat
        color, less reliably for photoreal areas.
      </p>
    </div>
  )
}
