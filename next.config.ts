import type { NextConfig } from 'next'

const config: NextConfig = {
  // Observatory pages benefit from SSR for SEO — signals and events must be indexable
  // Static generation where possible, dynamic where freshness is required
  experimental: {
    typedRoutes: true,
  },

  // Security headers — production baseline
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },

  // Image domains — add Supabase storage when configured
  images: {
    remotePatterns: [],
  },
}

export default config
