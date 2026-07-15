import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import { Nav } from '@/components/layout/nav'
import { Footer } from '@/components/layout/footer'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default:  'AIscentra — Intelligence Observatory',
    template: '%s | AIscentra',
  },
  description:
    'AIscentra is an independent AI Intelligence Observatory. We observe, analyze and interpret the global AI ecosystem — transforming fragmented information into structured intelligence.',
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
  twitter: {
    card:  'summary_large_image',
    title: 'AIscentra — Intelligence Observatory',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor:  '#0A0A0A',
  colorScheme: 'dark',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''

  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col bg-observatory-black">
        <Nav currentPath={pathname} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
