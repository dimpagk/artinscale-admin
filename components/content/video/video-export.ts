/**
 * Client-side Video Export
 *
 * Renders the Remotion composition frame-by-frame to a canvas,
 * then encodes to WebM/MP4 using MediaRecorder or WebCodecs API.
 *
 * This avoids server-side ffmpeg dependency — everything runs in the browser.
 */

import { getSlides, getPostFormat, type VisualConfig } from '@/lib/constants/content'

export type VideoFormat = 'reel' | 'square' | 'landscape' | 'story'

export interface VideoExportOptions {
  format: VideoFormat
  /** Seconds per slide (default 3) */
  secondsPerSlide?: number
  /** Frames per second (default 30) */
  fps?: number
  /** Video quality 0-1 (default 0.92) */
  quality?: number
  /** Progress callback (0-1) */
  onProgress?: (progress: number) => void
}

export const VIDEO_FORMATS = {
  reel: { label: 'Reel / TikTok', width: 1080, height: 1920, ratio: '9:16' },
  square: { label: 'Square Feed', width: 1080, height: 1080, ratio: '1:1' },
  landscape: { label: 'Landscape / YouTube', width: 1920, height: 1080, ratio: '16:9' },
  story: { label: 'Story', width: 1080, height: 1920, ratio: '9:16' },
} as const

/**
 * Get the total duration of the video in seconds
 */
export function getVideoDuration(config: VisualConfig, secondsPerSlide = 3): number {
  return getSlides(config).length * secondsPerSlide
}

/**
 * Check if WebCodecs API is available for high-quality export
 */
export function supportsWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined'
}

/**
 * Check if MediaRecorder supports webm
 */
export function supportsMediaRecorder(): boolean {
  if (typeof MediaRecorder === 'undefined') return false
  return MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
         MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ||
         MediaRecorder.isTypeSupported('video/webm')
}

/**
 * Get the best supported MIME type for MediaRecorder
 */
function getBestMimeType(): string {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return 'video/webm'
}

/**
 * Download a blob as a file
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Export post/carousel as video using canvas-based frame capture + MediaRecorder
 *
 * This works by:
 * 1. Creating an offscreen canvas
 * 2. For each frame, rendering the current slide state
 * 3. Capturing frames via canvas.captureStream() + MediaRecorder
 * 4. Downloading the result as WebM
 */
export async function exportVideoFromCanvas(
  renderFrame: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, frame: number, totalFrames: number) => void,
  options: VideoExportOptions & { filename: string }
): Promise<void> {
  const { format, fps = 30, quality = 0.92, onProgress, filename } = options
  const vf = VIDEO_FORMATS[format]
  const totalFrames = Math.ceil(getVideoDuration({ bg: '', dark: true, accent: '', footer: '', blocks: [] }, options.secondsPerSlide) * fps)

  // Create offscreen canvas
  const canvas = document.createElement('canvas')
  canvas.width = vf.width
  canvas.height = vf.height
  const ctx = canvas.getContext('2d')!

  // Set up MediaRecorder with canvas stream
  const stream = canvas.captureStream(fps)
  const mimeType = getBestMimeType()
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000, // 8 Mbps for good quality
  })

  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType })
      downloadBlob(blob, filename.replace(/\.(mp4|webm)$/, '') + '.webm')
      resolve()
    }

    recorder.onerror = (e) => reject(e)
    recorder.start()

    let currentFrame = 0
    const interval = 1000 / fps

    function tick() {
      if (currentFrame >= totalFrames) {
        recorder.stop()
        onProgress?.(1)
        return
      }

      renderFrame(canvas, ctx, currentFrame, totalFrames)
      onProgress?.(currentFrame / totalFrames)
      currentFrame++

      setTimeout(tick, interval)
    }

    tick()
  })
}
