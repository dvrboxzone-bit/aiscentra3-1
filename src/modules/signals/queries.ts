/**
 * AIscentra — Signal Queries
 *
 * Production Supabase queries. Same function signatures as mock.ts —
 * pages import from here without knowing the data source changed.
 *
 * All queries run in Server Components via the server Supabase client.
 * RLS: public reads ACTIVE and PROMOTED signals only (migration 004).
 */
import { createClient } from '@/lib/supabase/server'
import { getSignalSeverity } from '@/types/database'
import { selectFeaturedSignals } from './featured-selection'
import type { Signal, SignalCategory, SignalStatus } from '@/types/database'

export interface SignalFilters {
  category?: SignalCategory
  status?: SignalStatus
  minScore?: number
  limit?: number
  /** Zero-based row offset, for paginated listings. Requires `limit`. */
  offset?: number
}

// ── Core Queries ──────────────────────────────────────────────────────────────

export async function getSignals(filters: SignalFilters = {}): Promise<Signal[]> {
  const supabase = await createClient()

  let query = supabase.from('signals').select('*').order('created_at', { ascending: false })

  if (filters.category) {
    query = query.eq('category', filters.category)
  }

  // Public default: ACTIVE *and* PROMOTED. The previous code filtered
  // to ACTIVE alone while its own comment claimed "public RLS only
  // returns ACTIVE/PROMOTED anyway" -- the filter contradicted the
  // comment, so every PROMOTED signal (a signal important enough to
  // have been promoted into an Event, i.e. ranked ABOVE a plain ACTIVE
  // one) was invisible on every public page. Confirmed against
  // production: 2 such signals existed and appeared nowhere.
  // An explicit filters.status still narrows to exactly that status,
  // which is what the admin pages rely on.
  if (filters.status) {
    query = query.eq('status', filters.status)
  } else {
    query = query.in('status', ['ACTIVE', 'PROMOTED'])
  }

  if (filters.minScore !== undefined) {
    query = query.gte('signal_score', filters.minScore)
  }

  if (filters.limit) {
    if (filters.offset) {
      // Supabase's range() is inclusive on both ends, hence the -1.
      query = query.range(filters.offset, filters.offset + filters.limit - 1)
    } else {
      query = query.limit(filters.limit)
    }
  }

  const { data, error } = await query

  if (error) {
    console.error('[signals/queries] getSignals error:', error.message)
    return []
  }

  return (data ?? []) as Signal[]
}

/**
 * Total number of signals matching the same filters getSignals() would
 * apply, ignoring limit/offset. Needed because a listing page can only
 * honestly report "N signals" if N is the real total rather than the
 * size of the current page -- previously /signals rendered
 * "{signals.length} active signals detected", which capped at the page
 * limit (50) and therefore under-reported the real figure (121 in
 * production at the time of this fix).
 */
export async function getSignalsCount(
  filters: Omit<SignalFilters, 'limit' | 'offset'> = {},
): Promise<number> {
  const supabase = await createClient()

  let query = supabase.from('signals').select('*', { count: 'exact', head: true })

  if (filters.category) {
    query = query.eq('category', filters.category)
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  } else {
    query = query.in('status', ['ACTIVE', 'PROMOTED'])
  }

  if (filters.minScore !== undefined) {
    query = query.gte('signal_score', filters.minScore)
  }

  const { count, error } = await query

  if (error) {
    console.error('[signals/queries] getSignalsCount error:', error.message)
    return 0
  }

  return count ?? 0
}

export async function getSignalById(id: string): Promise<Signal | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.from('signals').select('*').eq('id', id).single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    console.error('[signals/queries] getSignalById error:', error.message)
    return null
  }

  return data as Signal
}

export async function getSignalStats(): Promise<{
  total: number
  critical: number
  high: number
  byCategory: Record<string, number>
}> {
  const signals = await getSignals({ limit: 200 })

  const byCategory: Record<string, number> = {}
  for (const s of signals) {
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1
  }

  return {
    total: signals.length,
    critical: signals.filter((s) => getSignalSeverity(s.signal_score) === 'CRITICAL').length,
    high: signals.filter((s) => getSignalSeverity(s.signal_score) === 'HIGH').length,
    byCategory,
  }
}

export async function getFeaturedSignals(): Promise<Signal[]> {
  // Fetch a broad-enough pool for selectFeaturedSignals to apply the
  // tier fallback-fill cascade correctly (it needs visibility into
  // Strong/Signal/Weak candidates together, not a pre-filtered slice).
  // 200 matches the pool size already used by getSignalStats() below.
  const pool = await getSignals({ limit: 200 })
  return selectFeaturedSignals(pool)
}

export async function getSignalsByEntity(entityId: string): Promise<Signal[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .contains('entity_ids', [entityId])
    .eq('status', 'ACTIVE')
    .order('signal_score', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[signals/queries] getSignalsByEntity error:', error.message)
    return []
  }

  return (data ?? []) as Signal[]
}
