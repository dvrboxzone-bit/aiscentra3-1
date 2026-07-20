import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default:  'AIscentra — Intelligence Observatory',
    template: '%s | AIscentra',
  },
  description: 'AIscentra is an independent AI Intelligence Observatory. Observe, analyze and interpret the global AI ecosystem.',
  keywords: ['AI intelligence', 'AI observatory', 'AI signals', 'AI ecosystem analysis'],
  authors: [{ name: 'AIscentra' }],
  creator: 'AIscentra',
  metadataBase: new URL(process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'),
  openGraph: {
    type:        'website',
    siteName:    'AIscentra',
    title:       'AIscentra — Intelligence Observatory',
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
