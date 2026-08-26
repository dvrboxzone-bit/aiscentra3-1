import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE:
      process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['GITHUB_SHA'] ?? '',
    NEXT_PUBLIC_SENTRY_ENVIRONMENT:
      process.env['VERCEL_ENV'] ?? process.env['NODE_ENV'] ?? 'development',
  },
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
  images: { remotePatterns: [] },
}

export default withSentryConfig(config, {
  org: 'aiscentra',
  project: 'javascript-nextjs',
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
  },
})
