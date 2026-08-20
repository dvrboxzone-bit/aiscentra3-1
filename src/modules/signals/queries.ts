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
  /** 1-indexed page number. Requires pageSize to also be set --
   * ignored otherwise (existing non-paginated callers, e.g. the
   * homepage's own limit-only usage, are completely unaffected). */
  page?: number
  pageSize?: number
}

// ── Core Queries ──────────────────────────────────────────────────────────────

export async function getSignals(filters: SignalFilters = {}): Promise<Signal[]> {
  const supabase = await createClient()

  // Stable sort with a mandatory tie-breaker: created_at alone is not
  // unique (multiple signals can share the same timestamp, especially
  // ones ingested in the same enrichment cycle) -- without a second,
  // deterministic ORDER BY column, rows sharing an identical
  // created_at have no defined relative order at all, and could
  // legitimately appear in a different sequence between two otherwise
  // identical queries. `id` (a UUID, already unique per row) closes
  // this gap for TIES within one query's own snapshot -- it does NOT,
  // by itself, guarantee zero duplicates or skips across separate
  // paginated requests against a live, growing table: a new signal
  // published between a visitor's page-1 and page-2 fetch still shifts
  // every subsequent row's real offset, which can shift a row onto a
  // different page than it would have occupied moments earlier. That
  // is an inherent property of offset-based (.range()) pagination
  // against changing data, not something this tie-breaker eliminates
  // -- it only removes the SEPARATE, avoidable non-determinism that
  // an unspecified tie order would otherwise add on top.
  let query = supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })

  if (filters.category) {
    query = query.eq('category', filters.category)
  }

  // Public default: ACTIVE and PROMOTED (matches the RLS policy
  // itself, "status = ANY (ARRAY['ACTIVE','PROMOTED'])") -- this
  // branch had diverged from main before PR #41 fixed the same
  // .eq('status','ACTIVE')-only bug there; reapplied here directly
  // rather than rebasing this deep into an already-large PR.
  if (filters.status) {
    query = query.eq('status', filters.status)
  } else {
    query = query.in('status', ['ACTIVE', 'PROMOTED'])
  }

  if (filters.minScore !== undefined) {
    query = query.gte('signal_score', filters.minScore)
  }

  // Real publication gate: "без безопасной и подтверждённо доступной
  // ссылки на оригинальный материал сигнал публично не показывается."
  // has_verified_source is a stored, denormalized boolean (see
  // migration 20260809095000) -- a single indexed column read here,
  // zero joins, zero network calls at query/render time.
  query = query.eq('has_verified_source', true)

  // Explicit page+pageSize takes precedence over a plain `limit` --
  // real, offset-based pagination via Supabase/PostgREST's own
  // .range() (inclusive both ends), not a client-side slice of an
  // unbounded fetch. Existing callers that only ever pass `limit`
  // (homepage, /observatory) are completely unaffected -- this branch
  // is only reached when BOTH page and pageSize are explicitly set.
  if (filters.page !== undefined && filters.pageSize !== undefined) {
    const from = (filters.page - 1) * filters.pageSize
    const to = from + filters.pageSize - 1
    query = query.range(from, to)
  } else if (filters.limit) {
    query = query.limit(filters.limit)
  }

  const { data, error } = await query

  if (error) {
    console.error('[signals/queries] getSignals error:', error.message)
    return []
  }

  return (data ?? []) as Signal[]
}

/**
 * Real count of publicly-visible signals matching the same real
 * filters getSignals() itself applies (status ACTIVE/PROMOTED unless
 * overridden, has_verified_source=true, optional category) -- used
 * for the real "N published signals" counter and real page-count
 * computation. REJECTED and unpublished (no verified source) signals
 * are never counted, matching the exact same publication gate as the
 * list query itself -- not a separately-maintained, potentially
 * drifting count.
 */
export async function getSignalsCount(
  filters: Pick<SignalFilters, 'category' | 'status'> = {},
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

  query = query.eq('has_verified_source', true)

  const { count, error } = await query

  if (error) {
    console.error('[signals/queries] getSignalsCount error:', error.message)
    return 0
  }

  return count ?? 0
}

export async function getSignalById(id: string): Promise<Signal | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .eq('id', id)
    .eq('has_verified_source', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found (or gated -- indistinguishable to a public visitor, correctly so)
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

  // REAL BUG FIXED (architectural review): this query previously had
  // no has_verified_source filter at all -- a signal with zero safe,
  // reachable sources could still be surfaced here, bypassing the
  // publication gate that getSignals/getSignalById both already
  // enforce. Same gate applied here for consistency.
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .contains('entity_ids', [entityId])
    .eq('status', 'ACTIVE')
    .eq('has_verified_source', true)
    .order('signal_score', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[signals/queries] getSignalsByEntity error:', error.message)
    return []
  }

  return (data ?? []) as Signal[]
}
