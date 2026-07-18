import type { MetadataRoute } from 'next'

const BASE_URL = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/signals', '/events', '/reports', '/search', '/about', '/observatory'],
        disallow: ['/admin', '/api/', '/assistant'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
