import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt     = 'AIscentra — Intelligence Observatory'
export const size    = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          background:    '#0A0A0A',
          width:         '100%',
          height:        '100%',
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'flex-start',
          justifyContent:'center',
          padding:       '80px',
          fontFamily:    'monospace',
        }}
      >
        {/* Grid lines */}
        <div style={{
          position:   'absolute',
          inset:      0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        {/* Label */}
        <div style={{
          fontSize:      14,
          color:         '#6A6A6A',
          letterSpacing: '0.3em',
          marginBottom:  24,
        }}>
          INTELLIGENCE OBSERVATORY
        </div>

        {/* Name */}
        <div style={{
          fontSize:    72,
          fontWeight:  300,
          color:       '#FFFFFF',
          lineHeight:  1.1,
          marginBottom: 24,
        }}>
          AIscentra
        </div>

        {/* Tagline */}
        <div style={{ fontSize: 24, color: '#6A6A6A' }}>
          Observe. Analyze. Accelerate the Future.
        </div>

        {/* Bottom bar */}
        <div style={{
          position:      'absolute',
          bottom:        48,
          left:          80,
          right:         80,
          height:        1,
          background:    '#242424',
        }} />
      </div>
    ),
    { ...size },
  )
}
