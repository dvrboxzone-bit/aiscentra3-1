import type { Config } from 'tailwindcss'

// AIscentra Design Foundation v1.0 color system
// Every value here maps directly to an approved document definition
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Background system — from Design Foundation v1.0
        observatory: {
          black:   '#0A0A0A', // Primary background
          dark:    '#111111', // Secondary background
          surface: '#171717', // Surface layer
          border:  '#242424', // Border layer
        },
        // Text system
        text: {
          primary:   '#FFFFFF',
          secondary: '#B5B5B5',
          muted:     '#7A7A7A',
        },
        // Signal severity colors — Design Foundation v1.0
        // These exist ONLY for intelligence classification, never decoration
        signal: {
          critical: '#FFFFFF', // Critical signal — white
          high:     '#D4D4D4', // High signal — light gray
          medium:   '#8A8A8A', // Medium signal — gray
          low:      '#4A4A4A', // Low signal — dark gray
        },
      },
      fontFamily: {
        // Modern Technical Editorial — Design Foundation v1.0
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        // Type scale — precision editorial system
        xs:   ['0.75rem',  { lineHeight: '1rem' }],
        sm:   ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem',     { lineHeight: '1.6rem' }],
        lg:   ['1.125rem', { lineHeight: '1.75rem' }],
        xl:   ['1.25rem',  { lineHeight: '1.75rem' }],
        '2xl':['1.5rem',   { lineHeight: '2rem' }],
        '3xl':['1.875rem', { lineHeight: '2.25rem' }],
        '4xl':['2.25rem',  { lineHeight: '2.5rem' }],
      },
      spacing: {
        // Grid system — structured content hierarchy
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      borderRadius: {
        // Minimal rounding — observatory aesthetic
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
      },
      animation: {
        // Observatory animations — signal activity, data flow
        // Motion communicates activity, not decoration (Design Foundation v1.0)
        'signal-pulse': 'signal-pulse 2s ease-in-out infinite',
        'data-flow':    'data-flow 1.5s linear infinite',
        'radar-sweep':  'radar-sweep 3s linear infinite',
      },
      keyframes: {
        'signal-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
        'data-flow': {
          '0%':   { strokeDashoffset: '24' },
          '100%': { strokeDashoffset: '0' },
        },
        'radar-sweep': {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      backgroundImage: {
        // Observatory background patterns — subtle grid, coordinate systems
        // Opacity minimal — support atmosphere, never compete with content
        'grid-pattern': `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
      },
      backgroundSize: {
        'grid': '32px 32px',
      },
    },
  },
  plugins: [],
}

export default config
