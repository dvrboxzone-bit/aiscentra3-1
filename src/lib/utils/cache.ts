/**
 * AIscentra — Cache Utilities
 *
 * Next.js 15 uses unstable_cache for data caching.
 * We wrap common queries with appropriate TTLs.
 *
 * Cache strategy:
 * - Signal feed: 1 hour (matches enrichment cycle)
 * - Signal detail: 1 hour + revalidate on update
 * - Observatory stats: 30 minutes
 * - Reports: 2 hours (generated daily)
 * - Search: no cache (dynamic, user-specific queries)
 */
import { unstable_cache } from 'next/cache'

export const CACHE_TAGS = {
  signals:          'signals',
  signal:           (id: string) => `signal-${id}`,
  events:           'events',
  event:            (id: string) => `event-${id}`,
  reports:          'reports',
  report:           (id: string) => `report-${id}`,
  observatoryStats: 'observatory-stats',
} as const

export const CACHE_TTL = {
  signalFeed:      3600,   // 1 hour
  signalDetail:    3600,   // 1 hour
  eventFeed:       3600,   // 1 hour
  eventDetail:     7200,   // 2 hours
  reportFeed:      7200,   // 2 hours
  reportDetail:    86400,  // 24 hours (immutable after publish)
  observatoryStats: 1800,  // 30 minutes
  search:          0,      // No cache
} as const

/**
 * Wrap a data fetching function with Next.js cache.
 * Usage: const cachedFn = withCache(fetchFn, ['tag'], 3600)
 */
export function withCache<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  tags: string[],
  ttl: number,
): (...args: T) => Promise<R> {
  return unstable_cache(fn, tags, {
    revalidate: ttl,
    tags,
  }) as (...args: T) => Promise<R>
}
