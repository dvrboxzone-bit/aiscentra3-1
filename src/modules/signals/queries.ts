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
}

// ── Core Queries ──────────────────────────────────────────────────────────────

export async function getSignals(filters: SignalFilters = {}): Promise<Signal[]> {
  const supabase = await createClient()

  let query = supabase.from('signals').select('*').order('created_at', { ascending: false })

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

  if (filters.limit) {
    query = query.limit(filters.limit)
  }

  const { data, error } = await query

  if (error) {
    console.error('[signals/queries] getSignals error:', error.message)
    return []
  }

  return (data ?? []) as Signal[]
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
