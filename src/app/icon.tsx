import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

/**
 * AIscentra — real favicon (Public Interactivity Correction checkpoint)
 *
 * REAL BUG FIXED (confirmed defect #3): no favicon existed at all
 * (no src/app/icon.*, no static favicon.ico) -- browsers requested
 * `/favicon.ico` and got a genuine 404. Next.js App Router's own
 * file-based icon convention (`src/app/icon.tsx`) is used instead of a
 * static asset so the mark can be generated from the same AIscentra
 * brand colors used everywhere else (deep obsidian background, frost
 * ring, mint-signal accent) rather than a placeholder.
 *
 * Div-only composition (border-radius circles + a rotated square for
 * the apex), matching the same JSX subset already proven to render a
 * real, non-empty PNG through this exact next/og pipeline in
 * src/app/opengraph-image.tsx and src/app/signals/[slug]/opengraph-image.tsx
 * -- no raw <svg> JSX (Satori's support for that is not exercised
 * anywhere else in this codebase, so it is not risked here for a
 * 32x32 icon where the difference is not visually meaningful).
 */
export default function Icon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0A0A',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: '2.5px solid #e5e7eb',
            borderTopColor: '#a3f305',
            borderRightColor: '#a3f305',
          }}
        />
      </div>
    ),
    { ...size },
  )
}
