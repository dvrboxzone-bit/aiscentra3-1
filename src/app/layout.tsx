import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

// vfinal Frontend Design Foundation: Inter (400;500;700) and JetBrains
// Mono (400;500) -- the exact weights the approved HTML source loads
// via its own Google Fonts <link>. Loaded through next/font (self-
// hosted at build time, zero runtime request to fonts.googleapis.com)
// per the explicit "не использовать runtime CDN... для шрифтов"
// instruction -- not the HTML's own <link>/CDN approach. CSS variables
// are additive (--font-pp/--font-mono in globals.css already reference
// 'Inter'/'JetBrains Mono' by family name, which next/font's generated
// @font-face satisfies automatically once these variables are applied
// to <html> below).
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const FALLBACK_APP_URL = 'https://aiscentra.com'

/**
 * NEXT_PUBLIC_APP_URL feeds directly into `new URL(...)` for
 * metadataBase below. A malformed value there previously crashed the
 * ENTIRE production build at page-data-collection time (a real
 * incident: `TypeError: Invalid URL` for `/_not-found`, confirmed via a
 * real release attempt's build log) -- disproportionate blast radius
 * for what is only an Open-Graph/metadata convenience field, not
 * anything the app's actual functionality depends on. This guard
 * parses the configured value defensively and falls back to the known-
 * good default on ANY failure, logging a warning (visible in the build
 * log, not swallowed silently) rather than aborting the whole build.
 */
function safeMetadataBaseUrl(): URL {
  const configured = process.env['NEXT_PUBLIC_APP_URL']
  if (!configured) return new URL(FALLBACK_APP_URL)
  try {
    return new URL(configured)
  } catch {
    console.warn(
      `[AIscentra] NEXT_PUBLIC_APP_URL is set but is not a valid URL; falling back to ${FALLBACK_APP_URL}. Check this value in Vercel Project Settings.`,
    )
    return new URL(FALLBACK_APP_URL)
  }
}

export const metadata: Metadata = {
  title: {
    default: 'AIscentra — Intelligence Observatory',
    template: '%s | AIscentra',
  },
  description:
    'AIscentra is an independent AI Intelligence Observatory. Observe, analyze and interpret the global AI ecosystem.',
  keywords: ['AI intelligence', 'AI observatory', 'AI signals', 'AI ecosystem analysis'],
  authors: [{ name: 'AIscentra' }],
  creator: 'AIscentra',
  metadataBase: safeMetadataBaseUrl(),
  openGraph: {
    type: 'website',
    siteName: 'AIscentra',
    title: 'AIscentra — Intelligence Observatory',
    description: 'Observe. Analyze. Accelerate the Future.',
  },
  twitter: { card: 'summary_large_image', title: 'AIscentra — Intelligence Observatory' },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
