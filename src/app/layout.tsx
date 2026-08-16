import type { Metadata, Viewport } from 'next'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './globals.css'

// REAL BUG FIXED (independent review, Quality Gate 31938267758
// FAILURE): next/font/google fetches its own font files from
// fonts.gstatic.com AT BUILD TIME -- a real, confirmed 404 from that
// external request broke Turbopack's font module compilation and
// failed the production build outright. next/font/google is
// documented as "self-hosted" only in the sense that the SERVED asset
// is same-origin at runtime; the BUILD ITSELF still depends on a live
// network fetch to Google's own CDN, which is exactly the kind of
// external, non-reproducible build dependency the task's own
// technical-boundaries section forbids ("без обязательного обращения
// к Google во время build").
//
// Fixed with @fontsource/inter and @fontsource/jetbrains-mono (exact
// pinned versions, see package.json) -- real npm packages that bundle
// the actual woff2 font files INSIDE the package itself (no network
// fetch of any kind, at build time or runtime). Same exact families
// and weights as before: Inter 400/500/700, JetBrains Mono 400/500 --
// the same weights the HTML source's own Google Fonts <link> requests.
// globals.css's own --font-pp/--font-mono custom properties already
// reference these family names directly ('Inter', 'JetBrains Mono'),
// which @fontsource's own @font-face declarations (imported here)
// satisfy identically to next/font's generated ones -- no change
// needed to globals.css itself.
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
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
