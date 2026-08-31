import type { MetadataRoute } from 'next'

/**
 * AIscentra — real Web App Manifest (explicit owner instruction,
 * "оптимизировать фавикон под другие устройства"). Next.js's own
 * file-based convention (app/manifest.ts) auto-generates the real
 * /manifest.webmanifest route and its <link rel="manifest"> tag --
 * no manual wiring needed. Real PNG icons (192x192, 512x512,
 * standard Android/PWA "add to home screen" sizes) rendered from the
 * same real icon.svg source already used for the browser favicon,
 * not a separately-designed asset.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AIscentra — Intelligence Observatory',
    short_name: 'AIscentra',
    description:
      'AIscentra is an independent AI Intelligence Observatory. Observe, analyze and interpret the global AI ecosystem.',
    start_url: '/',
    display: 'standalone',
    background_color: '#030303',
    theme_color: '#030303',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
