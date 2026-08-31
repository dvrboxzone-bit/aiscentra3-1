import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'AIscentra — Intelligence Observatory'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * AIscentra — Open Graph share image.
 *
 * Text + font corrected (explicit owner instruction, 2026-08-31): the
 * heading and description now use the site's own REAL, current hero
 * copy verbatim (src/app/page.tsx's own #hero section: "Intelligence
 * Observatory." + the real "AIscentra is continuous monitoring..."
 * paragraph) instead of the prior, separately-written "AIscentra" +
 * old generic tagline.
 *
 * Real font: --font-pp (the site's own real .font-display font-family
 * variable, globals.css) resolves to Inter -- not an exotic custom
 * typeface. Satori (next/og's underlying render engine) does NOT
 * inherit a site's own CSS fonts automatically; the real font bytes
 * must be fetched and passed explicitly via ImageResponse's own
 * `fonts` option (the standard, documented next/og pattern) -- fetched
 * here directly from Google Fonts' real CSS API at request time, not
 * assumed to already be available.
 *
 * REAL BUG FIXED EARLIER (owner-reported, confirmed by directly
 * downloading and viewing the real deployed PNG): the grid pattern was
 * invisible. Two real, separate causes were found and fixed: (1) the
 * "Grid lines" div needed `position: relative` on its parent; (2)
 * Satori does not reliably support the `inset: 0` CSS shorthand --
 * replaced with explicit top/left/right/bottom. Grid opacity/spacing
 * also matched to this site's own real .tech-grid values (0.08
 * opacity, 8px spacing). Kept as-is here, unaffected by this text/font
 * change.
 */
async function loadInter(weight: 400 | 500, text: string): Promise<ArrayBuffer> {
  const cssUrl = `https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&text=${encodeURIComponent(text)}`
  const css = await fetch(cssUrl, {
    headers: {
      // REAL BUG FIX: Satori (next/og's render engine) cannot parse
      // WOFF2 ("Unsupported OpenType signature wOF2", confirmed via a
      // real local server run). A modern-browser User-Agent makes
      // Google serve WOFF2 by default. An old User-Agent Google does
      // NOT recognize as WOFF2-capable makes it fall back to a real,
      // directly Satori-compatible WOFF (v1, not v2) source instead.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.57.2 (KHTML, like Gecko) Version/5.1.7 Safari/534.57.2',
    },
  }).then((res) => res.text())
  const fontUrlMatch = /src: url\(([^)]+)\) format\('woff'\)/.exec(css)
  const fontUrl = fontUrlMatch?.[1]
  if (!fontUrl) {
    throw new Error('Could not resolve a real WOFF Inter font URL from Google Fonts CSS response')
  }
  const fontResponse = await fetch(fontUrl)
  return fontResponse.arrayBuffer()
}

export default async function OGImage(): Promise<ImageResponse> {
  const headingText = 'Intelligence Observatory.'
  const bodyText =
    'AIscentra is continuous monitoring of the global AI ecosystem. We separate significant changes from noise and preserve the provenance of every statement.'
  const labelText = 'AIscentra'

  const [interMedium, interRegular] = await Promise.all([
    loadInter(500, headingText + labelText),
    loadInter(400, bodyText),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          background: '#0A0A0A',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px',
          fontFamily: 'Inter',
        }}
      >
        {/* Grid lines — matches this site's own real .tech-grid values */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),' +
              'linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '8px 8px',
          }}
        />

        {/* Label */}
        <div
          style={{
            fontSize: 14,
            fontFamily: 'monospace',
            color: '#6A6A6A',
            letterSpacing: '0.3em',
            marginBottom: 24,
          }}
        >
          {labelText.toUpperCase()}
        </div>

        {/* Real hero heading, verbatim from the site's own #hero section */}
        <div
          style={{
            fontSize: 68,
            fontWeight: 500,
            color: '#FFFFFF',
            lineHeight: 1.05,
            letterSpacing: '-0.036em',
            marginBottom: 28,
            maxWidth: 900,
          }}
        >
          {headingText}
        </div>

        {/* Real hero paragraph, verbatim */}
        <div
          style={{
            fontSize: 22,
            fontWeight: 400,
            lineHeight: 1.4,
            color: '#8A8A8A',
            maxWidth: 780,
          }}
        >
          {bodyText}
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            left: 80,
            right: 80,
            height: 1,
            background: '#242424',
          }}
        />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Inter', data: interMedium, weight: 500, style: 'normal' },
        { name: 'Inter', data: interRegular, weight: 400, style: 'normal' },
      ],
    },
  )
}
