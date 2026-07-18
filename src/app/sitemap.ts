import type { MetadataRoute } from 'next'
import { createAdminClient } from '@/lib/supabase/server'

const BASE_URL = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAdminClient()

  const [signals, events, reports] = await Promise.all([
    supabase.from('signals').select('id, updated_at').eq('status', 'ACTIVE').limit(500),
    supabase.from('events').select('id, updated_at').limit(500),
    supabase.from('reports').select('id, updated_at').not('published_at', 'is', null).limit(500),
  ])

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL,                  lastModified: new Date(), changeFrequency: 'hourly',  priority: 1.0 },
    { url: `${BASE_URL}/signals`,     lastModified: new Date(), changeFrequency: 'hourly',  priority: 0.9 },
    { url: `${BASE_URL}/events`,      lastModified: new Date(), changeFrequency: 'daily',   priority: 0.8 },
    { url: `${BASE_URL}/reports`,     lastModified: new Date(), changeFrequency: 'daily',   priority: 0.8 },
    { url: `${BASE_URL}/observatory`, lastModified: new Date(), changeFrequency: 'hourly',  priority: 0.7 },
    { url: `${BASE_URL}/assistant`,   lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/about`,       lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/search`,      lastModified: new Date(), changeFrequency: 'monthly', priority: 0.4 },
  ]

  const signalRoutes: MetadataRoute.Sitemap = (signals.data ?? []).map((s: { id: string; updated_at: string }) => ({
    url:             `${BASE_URL}/signals/${s.id}`,
    lastModified:    new Date(s.updated_at),
    changeFrequency: 'daily' as const,
    priority:        0.7,
  }))

  const eventRoutes: MetadataRoute.Sitemap = (events.data ?? []).map((e: { id: string; updated_at: string }) => ({
    url:             `${BASE_URL}/events/${e.id}`,
    lastModified:    new Date(e.updated_at),
    changeFrequency: 'weekly' as const,
    priority:        0.6,
  }))

  const reportRoutes: MetadataRoute.Sitemap = (reports.data ?? []).map((r: { id: string; updated_at: string }) => ({
    url:             `${BASE_URL}/reports/${r.id}`,
    lastModified:    new Date(r.updated_at),
    changeFrequency: 'monthly' as const,
    priority:        0.6,
  }))

  return [...staticRoutes, ...signalRoutes, ...eventRoutes, ...reportRoutes]
}
