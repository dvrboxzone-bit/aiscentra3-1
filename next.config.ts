import type { NextConfig } from 'next'

const config: NextConfig = {
  experimental: {
    typedRoutes: true,
  },

  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-Content-Type-Options',     value: 'nosniff' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      // Cache static Observatory content aggressively
      {
        source: '/signals/:path*',
        headers: [
          { key: 'Cache-Control', value: 's-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/events/:path*',
        headers: [
          { key: 'Cache-Control', value: 's-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/reports/:path*',
        headers: [
          { key: 'Cache-Control', value: 's-maxage=7200, stale-while-revalidate=86400' },
        ],
      },
    ]
  },

  images: {
    remotePatterns: [],
    formats: ['image/avif', 'image/webp'],
  },

  // Bundle analysis — set ANALYZE=true to inspect
  ...(process.env['ANALYZE'] === 'true' && {
    // add bundle analyzer if needed
  }),
}

export default config
