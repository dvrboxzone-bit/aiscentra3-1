'use client'

import { useEffect, useRef } from 'react'

const LINE_COUNT = 34
const CYCLE_SECONDS = 4.5

/** Dense raw input resolving into a sparse extracted signal. */
export function VfinalHeroDensityScan(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const densityCanvas = canvas

    let width = 0
    let height = 0
    let rafId = 0
    const startedAt = Date.now()
    function drawFrame(timeSeconds: number): void {
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)
      const breathe = 0.82 + 0.18 * Math.sin((timeSeconds / CYCLE_SECONDS) * Math.PI * 2)
      const minGap = 3 * breathe
      const maxGap = (width / 20) * breathe
      let x = 0
      let index = 0

      while (x < width && index < LINE_COUNT) {
        const fraction = index / (LINE_COUNT - 1)
        const gap = minGap + (maxGap - minGap) * fraction
        const lineHeight = height * 0.85
        const opacity = 0.12 + 0.6 * (1 - fraction)
        ctx.strokeStyle = `rgba(139, 157, 131, ${opacity})`
        ctx.lineWidth = fraction < 0.25 ? 2 : 1
        ctx.beginPath()
        ctx.moveTo(x, (height - lineHeight) / 2)
        ctx.lineTo(x, (height + lineHeight) / 2)
        ctx.stroke()
        x += gap
        index += 1
      }
    }

    function resizeCanvas(): void {
      if (!ctx) return
      // CSS owns the approved 70px/50px visual height. Measuring the
      // wrapper includes the status/count rows and feeding that value back
      // as an inline canvas height makes the wrapper grow on every resize.
      const rect = densityCanvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      densityCanvas.width = Math.round(width * window.devicePixelRatio)
      densityCanvas.height = Math.round(height * window.devicePixelRatio)
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0)
      drawFrame((Date.now() - startedAt) / 1000)
    }

    function draw(): void {
      drawFrame((Date.now() - startedAt) / 1000)
      rafId = requestAnimationFrame(draw)
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    draw()

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (rafId === 0) rafId = requestAnimationFrame(draw)
          } else {
            cancelAnimationFrame(rafId)
            rafId = 0
          }
        })
      },
      { threshold: 0.1 },
    )
    observer.observe(densityCanvas)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resizeCanvas)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="hero-density-scan-wrap" data-component="hero-density-scan">
      <div className="hero-density-scan-status">
        <span className="font-caption text-silver-haze">SYSTEM: SCANNING</span>
      </div>
      <div className="hero-density-scan-label">
        <span className="font-caption text-silver-haze">SIG</span>
        <span className="font-caption text-mint-signal">574,780</span>
      </div>
      <div className="hero-density-scan-container">
        <canvas ref={canvasRef} id="hero-density-scan" aria-hidden="true" />
      </div>
    </div>
  )
}
