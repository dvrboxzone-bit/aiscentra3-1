/**
 * AIscentra — Observation Queries
 *
 * Used by: Signal Engine (reads unprocessed observations),
 * Admin interface (monitoring), Health check.
 * All queries use the admin client — observations are not public.
 */
import { createAdminClient } from '@/lib/supabase/server'

export interface ObservationRow {
  id: string
  source_id: string
  title: string
  content: string
  url: string
  published_at: string
  collected_at: string
  processed: boolean
  processing_error: string | null
  signal_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export async function getUnprocessedObservations(limit = 20): Promise<ObservationRow[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('observations')
    .select('*')
    .eq('processed', false)
    .is('processing_error', null)
    .order('collected_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[observations/queries] getUnprocessed error:', error.message)
    return []
  }

  return (data ?? []) as ObservationRow[]
}

export async function markObservationProcessed(
  id: string,
  signalId: string | null,
  error?: string,
): Promise<void> {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('observations')
    .update({
      processed:        true,
      signal_id:        signalId,
      processing_error: error ?? null,
    })
    .eq('id', id)
}

/**
 * Mark observation for retry after rate limit (HTTP 429).
 * Does NOT set processing_error — keeps observation in the queue.
 */
export async function markObservationForRetry(
  id: string,
  retryAfterMs: number = 60_000,
): Promise<void> {
  const supabase = createAdminClient()
  const retryAt  = new Date(Date.now() + retryAfterMs).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('observations')
    .update({
      processed:        false,
      processing_error: null,
      metadata:         { retry_after: retryAt },
    })
    .eq('id', id)
}

export async function getObservationStats(): Promise<{
  total: number
  unprocessed: number
  withErrors: number
  last24h: number
}> {
  const supabase = createAdminClient()
  const since24h = new Date(Date.now() - 86400000).toISOString()

  const [total, unprocessed, withErrors, last24h] = await Promise.all([
    supabase.from('observations').select('id', { count: 'exact', head: true }),
    supabase.from('observations').select('id', { count: 'exact', head: true }).eq('processed', false),
    supabase.from('observations').select('id', { count: 'exact', head: true }).not('processing_error', 'is', null),
    supabase.from('observations').select('id', { count: 'exact', head: true }).gte('collected_at', since24h),
  ])

  return {
    total:       total.count ?? 0,
    unprocessed: unprocessed.count ?? 0,
    withErrors:  withErrors.count ?? 0,
    last24h:     last24h.count ?? 0,
  }
}
