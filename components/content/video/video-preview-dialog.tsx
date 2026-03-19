'use client'

/**
 * Video Preview & Export Dialog
 *
 * Shows a Remotion Player preview of the animated post/carousel,
 * with controls for video format, speed, and export.
 */

import { useState, useCallback, useRef } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { Play, Pause, Export, FilmStrip, X, Timer } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { PostVideoComposition, getVideoDurationInFrames, type PostVideoProps } from './post-video-composition'
import { VIDEO_FORMATS, type VideoFormat, supportsMediaRecorder } from './video-export'
import { getSlides, type VisualConfig } from '@/lib/constants/content'

interface VideoPreviewDialogProps {
  config: VisualConfig
  open: boolean
  onClose: () => void
  postTitle?: string
}

const FPS = 30

const SPEED_OPTIONS = [
  { label: '1.5s', value: 45, description: '1.5s per slide \u2014 TikTok pace' },
  { label: '2s', value: 60, description: '2s per slide \u2014 fast-paced' },
  { label: '2.5s', value: 75, description: '2.5s per slide \u2014 standard' },
  { label: '3s', value: 90, description: '3s per slide \u2014 slower' },
]

export function VideoPreviewDialog({ config, open, onClose, postTitle }: VideoPreviewDialogProps) {
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('reel')
  const [framesPerSlide, setFramesPerSlide] = useState(75)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const playerRef = useRef<PlayerRef>(null)

  const slides = getSlides(config)
  const totalFrames = getVideoDurationInFrames(config, framesPerSlide)
  const vf = VIDEO_FORMATS[videoFormat]
  const durationSec = (totalFrames / FPS).toFixed(1)

  // Calculate player display size to fit dialog
  const maxPlayerHeight = 480
  const maxPlayerWidth = 600
  const playerAspect = vf.width / vf.height
  let playerW: number, playerH: number
  if (playerAspect > maxPlayerWidth / maxPlayerHeight) {
    playerW = maxPlayerWidth
    playerH = maxPlayerWidth / playerAspect
  } else {
    playerH = maxPlayerHeight
    playerW = maxPlayerHeight * playerAspect
  }

  const handleExport = useCallback(async () => {
    if (!supportsMediaRecorder()) {
      alert('Your browser does not support video recording. Please use Chrome or Edge.')
      return
    }

    setExporting(true)
    setExportProgress(0)

    try {
      const player = playerRef.current
      if (!player) throw new Error('Player ref not available')

      // Pause the player and seek to start
      player.pause()
      player.seekTo(0)
      await new Promise(r => setTimeout(r, 100))

      // Use the player wrapper div to capture via captureStream on a canvas
      const playerDiv = document.querySelector('[data-remotion-player] > div') as HTMLElement
      if (!playerDiv) throw new Error('Player container not found')

      // Create an offscreen canvas matching the output resolution
      const canvas = document.createElement('canvas')
      canvas.width = vf.width
      canvas.height = vf.height
      const ctx = canvas.getContext('2d')!

      // Set up MediaRecorder on the canvas stream
      const stream = canvas.captureStream(FPS)
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
      })

      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      // Start recording and play through the video
      recorder.start(100)

      const totalDurationMs = (totalFrames / FPS) * 1000
      let startTime: number | null = null

      // Start playing
      player.seekTo(0)
      player.play()

      await new Promise<void>((resolve) => {
        function captureFrame(timestamp: number) {
          if (!startTime) startTime = timestamp
          const elapsed = timestamp - startTime
          const progress = Math.min(elapsed / totalDurationMs, 1)
          setExportProgress(progress)

          // Draw the player's current visual state onto our canvas
          const innerEl = playerDiv.querySelector('div[style]') as HTMLElement
          if (innerEl) {
            const innerCanvas = innerEl.querySelector('canvas') as HTMLCanvasElement | null
            if (innerCanvas) {
              ctx.drawImage(innerCanvas, 0, 0, vf.width, vf.height)
            } else {
              ctx.fillStyle = '#000000'
              ctx.fillRect(0, 0, vf.width, vf.height)
            }
          }

          if (progress >= 1) {
            player?.pause()
            recorder.stop()
            resolve()
            return
          }

          requestAnimationFrame(captureFrame)
        }

        requestAnimationFrame(captureFrame)
      })

      // Wait for recorder to finish
      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${(postTitle || 'artinscale-video').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.webm`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          resolve()
        }
      })

      setExportProgress(1)
    } catch (err) {
      console.error('Video export failed:', err)
      alert('Video export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }, [config, videoFormat, framesPerSlide, totalFrames, vf, postTitle])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-[#111] border border-white/10 rounded-2xl shadow-2xl max-w-[900px] w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F72D5E] to-[#F6B61C] flex items-center justify-center">
              <FilmStrip size={16} weight="bold" className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Video Preview</h3>
              <p className="text-[10px] text-white/40">{slides.length} slide{slides.length > 1 ? 's' : ''} &middot; {durationSec}s &middot; {vf.ratio}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex">
          {/* Player area */}
          <div className="flex-1 p-5 flex items-center justify-center bg-black/30" data-remotion-player>
            <div className="rounded-lg overflow-hidden shadow-xl" style={{ width: playerW, height: playerH }}>
              <Player
                ref={playerRef}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                component={PostVideoComposition as any}
                inputProps={{ config, framesPerSlide } as Record<string, unknown>}
                durationInFrames={totalFrames}
                compositionWidth={vf.width}
                compositionHeight={vf.height}
                fps={FPS}
                style={{ width: playerW, height: playerH }}
                controls
                loop
                autoPlay
              />
            </div>
          </div>

          {/* Controls sidebar */}
          <div className="w-[240px] border-l border-white/[0.06] p-4 space-y-5">
            {/* Format picker */}
            <div>
              <label className="text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-2 block">Format</label>
              <div className="space-y-1">
                {(Object.entries(VIDEO_FORMATS) as [VideoFormat, typeof VIDEO_FORMATS[VideoFormat]][]).map(([key, fmt]) => (
                  <button
                    key={key}
                    onClick={() => setVideoFormat(key)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                      videoFormat === key
                        ? 'bg-[#F72D5E]/10 border border-[#F72D5E]/30 text-[#F72D5E]'
                        : 'bg-white/[0.03] border border-white/[0.06] text-white/60 hover:text-white/80 hover:border-white/10'
                    }`}
                  >
                    <span className="font-semibold">{fmt.label}</span>
                    <span className="text-[10px] ml-1.5 opacity-60">{fmt.ratio}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Speed picker */}
            <div>
              <label className="text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Timer size={10} weight="bold" />
                Speed
              </label>
              <div className="grid grid-cols-4 gap-1">
                {SPEED_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setFramesPerSlide(opt.value)}
                    className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                      framesPerSlide === opt.value
                        ? 'bg-[#F72D5E]/15 text-[#F72D5E] border border-[#F72D5E]/30'
                        : 'bg-white/[0.03] text-white/40 border border-transparent hover:text-white/60'
                    }`}
                    title={opt.description}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-white/30 mt-1">
                {SPEED_OPTIONS.find(o => o.value === framesPerSlide)?.description}
              </p>
            </div>

            {/* Duration info */}
            <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-white/40">Duration</span>
                <span className="text-white font-bold">{durationSec}s</span>
              </div>
              <div className="flex items-center justify-between text-[10px] mt-1">
                <span className="text-white/40">Resolution</span>
                <span className="text-white font-bold">{vf.width}&times;{vf.height}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] mt-1">
                <span className="text-white/40">Slides</span>
                <span className="text-white font-bold">{slides.length}</span>
              </div>
            </div>

            {/* Export button */}
            <div className="space-y-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleExport}
                disabled={exporting}
                loading={exporting}
                icon={!exporting ? <Export size={14} weight="bold" /> : undefined}
                className="w-full h-10"
              >
                {exporting ? `Exporting ${Math.round(exportProgress * 100)}%` : 'Export Video'}
              </Button>

              {exporting && (
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#F72D5E] to-[#F6B61C] transition-all duration-300"
                    style={{ width: `${exportProgress * 100}%` }}
                  />
                </div>
              )}

              <p className="text-[9px] text-white/25 text-center">
                Exports as WebM &middot; Works best in Chrome
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
