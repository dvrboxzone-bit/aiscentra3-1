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

  let query = supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.category) {
    query = query.eq('category', filters.category)
  }

  // Default to ACTIVE — public RLS only returns ACTIVE/PROMOTED anyway
  query = query.eq('status', filters.status ?? 'ACTIVE')

  if (filters.minScore !== undefined) {
    query = query.gte('signal_score', filters.minScore)
  }

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
    .single()

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
    total:    signals.length,
    critical: signals.filter((s) => getSignalSeverity(s.signal_score) === 'CRITICAL').length,
    high:     signals.filter((s) => getSignalSeverity(s.signal_score) === 'HIGH').length,
    byCategory,
  }
}

export async function getFeaturedSignals(): Promise<Signal[]> {
  return getSignals({ minScore: 70, limit: 3 })
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
