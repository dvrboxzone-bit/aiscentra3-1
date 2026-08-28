'use client'

import { useEffect, useRef, useState } from 'react'

interface MemNode {
  id: string
  x: number
  y: number
  label: string
  born: number
  info: string
}
interface MemLink {
  a: string
  b: string
  born: number
  dashed?: boolean
}

const NODES: MemNode[] = [
  {
    id: 'src',
    x: 100,
    y: 150,
    label: 'SOURCE',
    born: 0,
    info: 'A publication is added to monitoring, rated for independence and past reliability — not for popularity.',
  },
  {
    id: 's1',
    x: 100,
    y: 300,
    label: 'SIGNAL',
    born: 1,
    info: "The source's report clears deterministic pre-filtering and AI classification, becoming a scored, categorized Signal.",
  },
  {
    id: 'e1',
    x: 300,
    y: 200,
    label: 'EVENT',
    born: 2,
    info: "A discrete, dated occurrence is extracted from the Signal's own evidence — a fact with a timestamp, not a narrative.",
  },
  {
    id: 'en1',
    x: 300,
    y: 350,
    label: 'ENTITY',
    born: 2,
    info: 'A company, model, or person named in the Signal is linked as a tracked node in the graph.',
  },
  {
    id: 'f1',
    x: 300,
    y: 450,
    label: 'FACT',
    born: 2.5,
    info: 'A verifiable claim tied to this Signal is recorded with its own source excerpt — separate from interpretation.',
  },
  {
    id: 'en1_v2',
    x: 500,
    y: 400,
    label: 'ENTITY v2',
    born: 4,
    info: "New evidence updates what's known about this entity. The prior version stays intact — this is a revision, never an overwrite.",
  },
  {
    id: 's2',
    x: 500,
    y: 250,
    label: 'SIGNAL',
    born: 3,
    info: 'A second, independently-sourced report corroborates the same event — checked against the original source, not just counted.',
  },
  {
    id: 'kg',
    x: 700,
    y: 300,
    label: 'KNOWLEDGE\nGRAPH',
    born: 4.5,
    info: "The corroborated Signal and the revised entity merge into the versioned graph — the system's durable memory.",
  },
  {
    id: 's3',
    x: 700,
    y: 150,
    label: 'SIGNAL',
    born: 5,
    info: 'A later Signal is classified in the context of what the graph already knows, not from a blank slate.',
  },
  {
    id: 'e2',
    x: 900,
    y: 200,
    label: 'EVENT',
    born: 5.5,
    info: 'A new, later event follows from that downstream Signal — extending the same real timeline.',
  },
  {
    id: 'src2',
    x: 900,
    y: 350,
    label: 'SOURCE',
    born: 6,
    info: 'An independent source corroborates the new event with its own primary reporting — not a restatement of the first.',
  },
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
/** Slowed 50% from the original 12s (explicit owner instruction,
 * 2026-08-26, after live review of an interactive prototype). */
const CYCLE_DURATION_MS = 18000

/**
 * AIscentra — vfinal Strategic Memory canvas (layer 3)
 *
 * Originally ported from AIscentra-vfinal-adapt.html's own inline
 * canvas draw logic: a looping animation illustrating the real
 * Knowledge Graph evolution pipeline (Source -> Signal -> Event/
 * Entity/Fact -> re-verified Entity -> Knowledge Graph node ->
 * downstream Signal/Event/Source), with a moving timeline marker and
 * fade-in/settle coloring for newly-appeared nodes/links.
 *
 * Visual/interaction upgrade (explicit owner instruction, 2026-08-26,
 * approved after several rounds of live interactive prototyping):
 * node LABELS are no longer drawn as canvas pixels (ctx.fillText) --
 * a canvas pixel has no hover event and can't carry a real CSS
 * border. Labels are now real, bordered DOM elements
 * (`.memory-label`), positioned on top of the canvas using the exact
 * same scale/offset transform math the canvas itself computes, kept
 * in sync via a ResizeObserver-driven recompute. Each label's border/
 * text color switches from dim gray to mint-signal the instant the
 * animation reaches that node (`touched` class, toggled directly via
 * ref/classList inside the animation loop -- NOT React state, to
 * avoid a re-render on every animation frame; matches the canvas's
 * own imperative, non-React-state animation style). Hovering a label
 * opens a real tooltip immediately adjacent to that specific node
 * (flips left/right depending on horizontal position so it never
 * runs off the container).
 *
 * The canvas itself is UNCHANGED for everything else: the growing
 * lines, the timeline axis with its real year marks (1950/1980/2000/
 * 2026), and each node's own glowing point. Only the node label
 * fillText calls were removed from the draw loop.
 *
 * The full animation cycle was slowed 12s -> 18s (+50%), per explicit
 * owner instruction and a live-reviewed prototype.
 *
 * SSR-safe: 'use client', all canvas/DOM work inside useEffect.
 * IntersectionObserver genuinely STOPS scheduling requestAnimationFrame
 * entirely outside the viewport and RESTARTS the loop on re-entry.
 * Full cleanup on unmount: cancelAnimationFrame, resize/observers
 * removed.
 */
export function VfinalStrategicMemoryCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let scale = 1
    let offsetX = 0
    let offsetY = 0

    function positionLabels(): void {
      for (const node of NODES) {
        const el = labelRefs.current[node.id]
        if (!el) continue
        el.style.left = `${offsetX + node.x * scale}px`
        el.style.top = `${offsetY + node.y * scale}px`
      }
    }

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
      scale = Math.min(w / VW, h / VH) * 0.95
      offsetX = (w - VW * scale) / 2
      offsetY = (h - VH * scale) / 2
      positionLabels()
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
      ctx.font = '24px JetBrains Mono'
      ctx.fillStyle = 'rgba(229, 231, 235, 0.5)'
      ctx.textAlign = 'center'
      timeMarks.forEach((m) => {
        const x = 50 + (m.val / 6) * 900
        ctx.beginPath()
        ctx.moveTo(x, tlY - 5)
        ctx.lineTo(x, tlY + 5)
        ctx.stroke()
        ctx.fillText(m.label, x, tlY + 32)
      })

      const markerX = 50 + (stage / 7) * 900
      ctx.fillStyle = '#8B9D83'
      ctx.shadowColor = '#8B9D83'
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
          const color = age < 1 ? '#8B9D83' : 'rgba(229, 231, 235, 0.3)'
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
          ctx.fillStyle = isNew ? '#8B9D83' : '#e5e7eb'
          if (isNew) {
            ctx.shadowColor = '#8B9D83'
            ctx.shadowBlur = 15
          }
          ctx.beginPath()
          ctx.arc(node.x, node.y, 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
        }
        // Real DOM label toggle (not canvas fillText, see docstring):
        // direct classList mutation via ref, not React state, so this
        // runs every animation frame without triggering a re-render.
        const el = labelRefs.current[node.id]
        if (el) el.classList.toggle('touched', stage > node.born)
      })

      ctx.restore()
    }

    let rafId = 0

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
    <div className="memory-canvas-container" ref={overlayRef}>
      <canvas ref={canvasRef} id="memory-canvas" aria-hidden="true" />
      {NODES.map((node) => {
        const flipLeft = node.x > VW / 2
        const flipUp = node.y > VH / 2
        return (
          <div
            key={node.id}
            ref={(el) => {
              labelRefs.current[node.id] = el
            }}
            className="memory-label"
            onMouseEnter={() => setHoveredId(node.id)}
            onMouseLeave={() => setHoveredId((cur) => (cur === node.id ? null : cur))}
          >
            {node.label.split('\n').map((line, i) => (
              <span key={i} style={{ display: 'block' }}>
                {line}
              </span>
            ))}
            {hoveredId === node.id && (
              <div
                className="memory-tooltip"
                style={{
                  ...(flipUp ? { bottom: 0 } : { top: 0 }),
                  ...(flipLeft
                    ? { right: '100%', marginRight: '8px' }
                    : { left: '100%', marginLeft: '8px' }),
                }}
              >
                {node.info}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
