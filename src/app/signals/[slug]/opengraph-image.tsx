/**
 * AIscentra — Per-Signal Illustration
 *
 * Generated entirely by code via Next.js's built-in `next/og`
 * ImageResponse API (JSX -> SVG -> PNG through Satori, the same
 * mechanism the site-wide src/app/opengraph-image.tsx already uses) --
 * no external AI image generation, no added dependency, no per-call
 * cost. 1200x630, matching the standard Open Graph image ratio.
 *
 * Caching: Next.js's file-based opengraph-image convention already
 * caches the rendered output at the framework/CDN level once
 * generated for a given route; `revalidate` below controls how long
 * that cached render is reused before a fresh one is produced (a
 * signal's score/category/title do not change after publication, so a
 * long revalidate window is correct here, not merely a performance
 * shortcut).
 *
 * Fallback: if the signal cannot be found or a lookup fails for any
 * reason, this route renders a plain palette-only placeholder instead
 * of throwing -- an Open Graph image request must never 500.
 */
import { ImageResponse } from 'next/og'
import { getSignalById } from '@/modules/signals/queries'
import {
  motifForCategory,
  extractKeyword,
  ILLUSTRATION_PALETTE,
} from '@/modules/signals/illustration-style'
import { formatCategory } from '@/lib/utils/format'
import type { IllustrationMotif } from '@/modules/signals/illustration-style'

export const runtime = 'edge'
export const alt = 'AIscentra Signal'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 86400 // 24h — signal content is immutable post-publication

const P = ILLUSTRATION_PALETTE

/**
 * Renders the abstract motif as absolutely-positioned shapes within a
 * 1200x630 canvas, using only plain divs (background/border/border-radius/
 * transform:rotate) -- primitives Satori reliably supports, rather than
 * hand-authored SVG paths.
 */
function Motif({ motif }: { motif: IllustrationMotif }): React.JSX.Element {
  const ringStyle = (size: number, opacity: number): React.CSSProperties => ({
    position: 'absolute',
    width: size,
    height: size,
    borderRadius: '50%',
    border: `2px solid ${P.textMuted}`,
    opacity,
    top: '50%',
    left: '50%',
    marginTop: -size / 2,
    marginLeft: -size / 2,
  })

  switch (motif) {
    case 'CONCENTRIC_RINGS':
      return (
        <>
          <div style={ringStyle(420, 0.25)} />
          <div style={ringStyle(300, 0.4)} />
          <div style={ringStyle(180, 0.6)} />
        </>
      )

    case 'LAYERED_BARS': {
      const widths = [560, 460, 500, 380, 440]
      return (
        <>
          {widths.map((w, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 320,
                top: 180 + i * 42,
                width: w,
                height: 20,
                backgroundColor: P.textMuted,
                opacity: 0.3 + i * 0.12,
              }}
            />
          ))}
        </>
      )
    }

    case 'OVERLAPPING_SQUARES':
      return (
        <>
          <div
            style={{
              position: 'absolute',
              width: 260,
              height: 260,
              border: `2px solid ${P.textMuted}`,
              opacity: 0.3,
              top: 140,
              left: 380,
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 260,
              height: 260,
              border: `2px solid ${P.textMuted}`,
              opacity: 0.45,
              top: 220,
              left: 480,
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 260,
              height: 260,
              border: `2px solid ${P.textMuted}`,
              opacity: 0.6,
              top: 300,
              left: 580,
            }}
          />
        </>
      )

    case 'LATTICE_GRID': {
      const cells = Array.from({ length: 6 })
      return (
        <>
          {cells.map((_, row) =>
            cells.map((__, col) => (
              <div
                key={`${row}-${col}`}
                style={{
                  position: 'absolute',
                  width: 64,
                  height: 64,
                  border: `1px solid ${P.textMuted}`,
                  opacity: 0.25,
                  top: 120 + row * 70,
                  left: 340 + col * 70,
                }}
              />
            )),
          )}
        </>
      )
    }

    case 'BRANCHING_LINES': {
      const angles = [-40, -20, 0, 20, 40]
      return (
        <>
          {angles.map((deg, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: 4,
                height: 320,
                backgroundColor: P.textMuted,
                opacity: 0.4,
                top: 155,
                left: 596,
                transform: `rotate(${deg}deg)`,
                transformOrigin: 'top center',
              }}
            />
          ))}
        </>
      )
    }

    case 'ASCENDING_BARS': {
      const heights = [80, 130, 170, 220, 280]
      return (
        <>
          {heights.map((h, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: 70,
                height: h,
                backgroundColor: P.textMuted,
                opacity: 0.3 + i * 0.12,
                bottom: 175,
                left: 350 + i * 100,
              }}
            />
          ))}
        </>
      )
    }

    case 'PARALLEL_LINES': {
      const rows = Array.from({ length: 6 })
      return (
        <>
          {rows.map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: 600,
                height: 3,
                backgroundColor: P.textMuted,
                opacity: 0.25 + i * 0.08,
                top: 190 + i * 42,
                left: 320,
              }}
            />
          ))}
        </>
      )
    }

    case 'CONNECTED_NODES': {
      const positions: Array<[number, number]> = [
        [360, 220],
        [560, 160],
        [760, 240],
        [500, 380],
        [700, 420],
      ]
      return (
        <>
          {positions.map(([x, y], i) => (
            <div
              key={`node-${i}`}
              style={{
                position: 'absolute',
                width: 18,
                height: 18,
                borderRadius: '50%',
                backgroundColor: P.textMuted,
                opacity: 0.6,
                top: y,
                left: x,
              }}
            />
          ))}
        </>
      )
    }

    case 'ANGULAR_BLOCKS':
    default: {
      const blocks = [
        { top: 180, left: 400, w: 180, h: 90, deg: -8 },
        { top: 300, left: 560, w: 220, h: 100, deg: 6 },
        { top: 420, left: 380, w: 160, h: 80, deg: 12 },
      ]
      return (
        <>
          {blocks.map((b, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: b.w,
                height: b.h,
                border: `2px solid ${P.textMuted}`,
                opacity: 0.35 + i * 0.15,
                top: b.top,
                left: b.left,
                transform: `rotate(${b.deg}deg)`,
              }}
            />
          ))}
        </>
      )
    }
  }
}

function FallbackImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          background: P.black,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ fontSize: 28, color: P.textMuted, letterSpacing: '0.3em' }}>
          AISCENTRA INTELLIGENCE OBSERVATORY
        </div>
      </div>
    ),
    { ...size },
  )
}

export default async function SignalOGImage({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<ImageResponse> {
  try {
    const { slug } = await params
    const signal = await getSignalById(slug)
    if (!signal) return FallbackImage()

    const motif = motifForCategory(signal.category)
    const keyword = extractKeyword(signal.title)

    return new ImageResponse(
      (
        <div
          style={{
            background: P.black,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            fontFamily: 'monospace',
          }}
        >
          {/* Abstract motif, behind the text */}
          <Motif motif={motif} />

          {/* Foreground content */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              padding: 64,
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: 14,
                  color: P.textMuted,
                  letterSpacing: '0.3em',
                }}
              >
                AISCENTRA — {formatCategory(signal.category).toUpperCase()}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  fontSize: 88,
                  fontWeight: 300,
                  color: P.textPrimary,
                  letterSpacing: '0.02em',
                  lineHeight: 1,
                }}
              >
                {keyword}
              </div>
              <div style={{ display: 'flex', marginTop: 24, fontSize: 20, color: P.textMuted }}>
                Signal {signal.signal_score} · Confidence {signal.confidence_score}
              </div>
            </div>
          </div>
        </div>
      ),
      { ...size },
    )
  } catch {
    // Never let an illustration failure become a 500 for an OG image.
    return FallbackImage()
  }
}
