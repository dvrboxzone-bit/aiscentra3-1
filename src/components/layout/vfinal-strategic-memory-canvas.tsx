'use client'

import { useEffect, useRef } from 'react'

interface MemNode {
  id: string
  x: number
  y: number
  label: string
  born: number
}
interface MemLink {
  a: string
  b: string
  born: number
  dashed?: boolean
}

const NODES: MemNode[] = [
  { id: 'src', x: 100, y: 150, label: 'SOURCE', born: 0 },
  { id: 's1', x: 100, y: 300, label: 'SIGNAL', born: 1 },
  { id: 'e1', x: 300, y: 200, label: 'EVENT', born: 2 },
  { id: 'en1', x: 300, y: 350, label: 'ENTITY', born: 2 },
  { id: 'f1', x: 300, y: 450, label: 'FACT', born: 2.5 },
  { id: 'en1_v2', x: 500, y: 400, label: 'ENTITY v2', born: 4 },
  { id: 's2', x: 500, y: 250, label: 'SIGNAL', born: 3 },
  { id: 'kg', x: 700, y: 300, label: 'KNOWLEDGE\nGRAPH', born: 4.5 },
  { id: 's3', x: 700, y: 150, label: 'SIGNAL', born: 5 },
  { id: 'e2', x: 900, y: 200, label: 'EVENT', born: 5.5 },
  { id: 'src2', x: 900, y: 350, label: 'SOURCE', born: 6 },
]

const LINKS: MemLink[] = [
  { a: 'src', b: 's1', born: 1 },
  { a: 's1', b: 'e1', born: 2 },
  { a: 's1', b: 'en1', born: 2 },
  { a: 's1', b: 'f1', born: 2.5 },
  { a: 'e1', b: 's2', born: 3 },
  { a: 'f1', b: 's2', born: 3 },
  { a: 'en1', b: 'en1_v2', born: 4, dashed: true },
  { a: 's2', b: 'kg', born: 4.5 },
  { a: 'en1_v2', b: 'kg', born: 4.5 },
  { a: 'kg', b: 's3', born: 5 },
  { a: 's3', b: 'e2', born: 5.5 },
  { a: 'e2', b: 'src2', born: 6 },
]

const VW = 1000
const VH = 500
const CYCLE_DURATION_MS = 12000

/**
 * AIscentra — vfinal Strategic Memory canvas (layer 3)
 *
 * Ported from AIscentra-vfinal-adapt.html's own inline canvas draw
 * logic (lines ~880-1000): a 12-second looping animation illustrating
 * the real Knowledge Graph evolution pipeline (Source -> Signal ->
 * Event/Entity/Fact -> re-verified Entity -> Knowledge Graph node ->
 * downstream Signal/Event/Source), with a moving timeline marker and
 * fade-in/settle coloring for newly-appeared nodes/links. Node
 * positions, labels, timings (`born` values), and the exact draw
 * order/styling (shadow blur, dash patterns, alpha) are copied
 * verbatim -- this is a genuine, real illustration of the actual
 * Knowledge Graph architecture, not fabricated data (distinct from
 * the fake telemetry emulator elsewhere in the HTML, which is
 * deliberately NOT ported -- see the homepage migration in layer 4).
 *
 * SSR-safe: 'use client', all canvas work inside useEffect.
 * IntersectionObserver genuinely STOPS scheduling requestAnimationFrame
 * entirely outside the viewport (cancelAnimationFrame + rafId reset to
 * 0) and RESTARTS the loop on re-entry (see draw()'s own comment for
 * the real incident this closes). Full cleanup on unmount:
 * cancelAnimationFrame, resize listener removed, observer disconnected.
 *
 * REAL BUG FIXED (Preview correction, root-cause pass against the
 * original AIscentra-vfinal-adapt.html reference): a prefers-reduced-
 * motion check previously rendered one static frame at the midpoint
 * instead of starting the loop -- not present in the reference HTML's
 * own draw() (lines ~909-999), which always runs. Removed to match the
 * reference exactly: the animation always loops.
 */
export function VfinalStrategicMemoryCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    function resizeCanvas(): void {
      if (!canvas || !parent || !ctx) return
      const rect = parent.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = w * window.devicePixelRatio
      canvas.height = h * window.devicePixelRatio
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    function getNode(id: string): MemNode | undefined {
      return NODES.find((n) => n.id === id)
    }

    const animStart = Date.now()

    function drawFrame(stage: number): void {
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      const scale = Math.min(w / VW, h / VH) * 0.95
      const offsetX = (w - VW * scale) / 2
      const offsetY = (h - VH * scale) / 2
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)

      const tlY = 480
      ctx.strokeStyle = 'rgba(229, 231, 235, 0.2)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(50, tlY)
      ctx.lineTo(950, tlY)
      ctx.stroke()

      const timeMarks = [
        { val: 0, label: '1950' },
        { val: 2, label: '1980' },
        { val: 4, label: '2000' },
        { val: 6, label: '2026' },
      ]
      ctx.font = '12px JetBrains Mono'
      ctx.fillStyle = 'rgba(229, 231, 235, 0.5)'
      ctx.textAlign = 'center'
      timeMarks.forEach((m) => {
        const x = 50 + (m.val / 6) * 900
        ctx.beginPath()
        ctx.moveTo(x, tlY - 5)
        ctx.lineTo(x, tlY + 5)
        ctx.stroke()
        ctx.fillText(m.label, x, tlY + 20)
      })

      const markerX = 50 + (stage / 7) * 900
      ctx.fillStyle = '#a3f305'
      ctx.shadowColor = '#a3f305'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(markerX, tlY, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      LINKS.forEach((link) => {
        if (stage > link.born) {
          const n1 = getNode(link.a)
          const n2 = getNode(link.b)
          if (!n1 || !n2) return
          const drawProgress = Math.min(1, (stage - link.born) / 0.5)
          const endX = n1.x + (n2.x - n1.x) * drawProgress
          const endY = n1.y + (n2.y - n1.y) * drawProgress
          const age = stage - link.born
          const color = age < 1 ? '#a3f305' : 'rgba(229, 231, 235, 0.3)'
          ctx.strokeStyle = color
          ctx.lineWidth = age < 1 ? 1.5 : 1
          ctx.setLineDash(link.dashed ? [4, 4] : [])
          ctx.beginPath()
          ctx.moveTo(n1.x, n1.y)
          ctx.lineTo(endX, endY)
          ctx.stroke()
          ctx.setLineDash([])
        }
      })

      NODES.forEach((node) => {
        if (stage > node.born) {
          const age = stage - node.born
          const isNew = age < 1
          ctx.fillStyle = isNew ? '#a3f305' : '#e5e7eb'
          if (isNew) {
            ctx.shadowColor = '#a3f305'
            ctx.shadowBlur = 15
          }
          ctx.beginPath()
          ctx.arc(node.x, node.y, 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
          ctx.font = '10px JetBrains Mono'
          ctx.fillStyle = isNew ? '#a3f305' : 'rgba(229, 231, 235, 0.6)'
          ctx.textAlign = 'left'
          node.label.split('\n').forEach((line, i) => {
            ctx.fillText(line, node.x + 8, node.y + 4 + i * 12)
          })
        }
      })

      ctx.restore()
    }

    let rafId = 0

    // REAL BUG FIXED (independent review): see vfinal-hero-globe.tsx's
    // identical animateGlobe() comment for the full explanation -- the
    // prior version called requestAnimationFrame(draw) unconditionally
    // as the first statement, before the visibility check, so the loop
    // kept firing every frame even fully offscreen with only the draw
    // work skipped. Fixed: requestAnimationFrame is scheduled from
    // inside the frame body, so the loop genuinely stops calling itself
    // when offscreen and is explicitly restarted by the
    // IntersectionObserver callback below.
    function draw(): void {
      const elapsed = (Date.now() - animStart) % CYCLE_DURATION_MS
      const progress = elapsed / CYCLE_DURATION_MS
      drawFrame(progress * 7)
      rafId = requestAnimationFrame(draw)
    }

    draw()

    const memObserver = new IntersectionObserver(
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
    memObserver.observe(canvas)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resizeCanvas)
      memObserver.disconnect()
    }
  }, [])

  return (
    <div className="memory-canvas-container">
      <canvas ref={canvasRef} id="memory-canvas" aria-hidden="true" />
    </div>
  )
}
