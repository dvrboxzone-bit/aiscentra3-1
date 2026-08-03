/**
 * AIscentra — Observation Queries
 * Updated for Signal Engine V2
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
  metadata: Record<string, unknown>
  processed: boolean
  processing_error: string | null
  signal_id: string | null
  qualification_result: string | null
  rejection_code: string | null
  rejection_reason: string | null
  rejection_detail: Record<string, unknown>
  qualification_score: number | null
  dry_run_result: Record<string, unknown>
  engine_version: string
  created_at: string
}

export async function getUnprocessedObservations(limit = 8): Promise<ObservationRow[]> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('observations')
    .select('*')
    .eq('processed', false)
    .is('processing_error', null)
    .order('collected_at', { ascending: true })
    .limit(limit * 3)

  if (error) {
    console.error('[observations/queries] getUnprocessed error:', error.message)
    return []
  }

  const rows = (data ?? []) as ObservationRow[]
  const ready = rows.filter((obs) => {
    const retryAfter = (obs.metadata as { retry_after?: string })?.retry_after
    return !retryAfter || retryAfter < now
  })
  return ready.slice(0, limit)
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
      processed: true,
      signal_id: signalId,
      processing_error: error ?? null,
    })
    .eq('id', id)
}

export async function markObservationForRetry(
  id: string,
  retryAfterMs: number = 60_000,
): Promise<void> {
  const supabase = createAdminClient()
  const retryAt = new Date(Date.now() + retryAfterMs).toISOString()

  // Real bug fixed here: the previous version wrote
  // `metadata: { retry_after: retryAt }` directly, wholesale replacing
  // the entire metadata JSONB column and silently discarding any other
  // fields already stored there (e.g. feed_url, set by the collector).
  // Read the existing value first and merge, never overwrite.
  const { data: existing, error: readError } =
    (await // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('observations').select('metadata').eq('id', id).single()) as {
      data: { metadata: Record<string, unknown> | null } | null
      error: { message: string } | null
    }

  if (readError) {
    throw new Error(
      `[markObservationForRetry] failed to read existing metadata for ${id} before requeue: ${readError.message}`,
    )
  }

  const existingMetadata = existing?.metadata ?? {}

  // Real bug fixed here: the previous version never inspected the
  // Supabase response at all -- a failed update was silently treated
  // as success by every caller, which could report `retried++` for an
  // observation that was never actually requeued (still marked
  // processed=false with no retry_after, but the caller believed it
  // was safely back in the queue).
  const { error: updateError } =
    await // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('observations')
      .update({
        processed: false,
        processing_error: null,
        metadata: { ...existingMetadata, retry_after: retryAt },
      })
      .eq('id', id)

  if (updateError) {
    throw new Error(`[markObservationForRetry] failed to requeue ${id}: ${updateError.message}`)
  }
}

export async function markObservationRejected(
  id: string,
  rejectionCode: string,
  rejectionReason: string,
  qualificationScore: number,
): Promise<void> {
  const supabase = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('observations')
    .update({
      processed: true,
      processing_error: null,
      qualification_result: 'DISCARD',
      rejection_code: rejectionCode,
      rejection_reason: rejectionReason,
      qualification_score: qualificationScore,
      engine_version: 'v2.0',
    })
    .eq('id', id)
}

export async function getObservationStats(): Promise<{
  total: number
  processed: number
  unprocessed: number
  errors: number
}> {
  const supabase = createAdminClient()
  const [total, processed, errors] = await Promise.all([
    supabase.from('observations').select('id', { count: 'exact', head: true }),
    supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .eq('processed', true),
    supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .not('processing_error', 'is', null),
  ])
  const t = total.count ?? 0
  const p = processed.count ?? 0
  return { total: t, processed: p, unprocessed: t - p, errors: errors.count ?? 0 }
}
