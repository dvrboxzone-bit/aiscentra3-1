/**
 * AIscentra — Observation Queries
 * Updated for Signal Engine V2
 */
import { createAdminClient } from '@/lib/supabase/server'
import { buildFaviconUrl, filterSafeSourceLinks, type SourceLink } from '@/lib/utils/source-links'

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
  /** Real, stored result of a one-time reachability check -- see
   * verifyUrlReachable in source-links.ts and /api/cron/verify-urls.
   * NULL = never checked yet. */
  url_verified_ok: boolean | null
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
): Promise<{ ok: boolean; writeError?: string }> {
  const supabase = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: writeError } = await (supabase as any)
    .from('observations')
    .update({
      processed: true,
      signal_id: signalId,
      processing_error: error ?? null,
    })
    .eq('id', id)

  // REAL PRODUCTION INCIDENT this closes: this write's own error was
  // previously discarded entirely (never destructured, never checked).
  // If the write genuinely failed, the observation could remain
  // processed=false in the database while the CALLER (enrich/batch's
  // main loop) had already counted it as a successfully processed item
  // in pipeline_metrics -- a write that never actually landed reported
  // as a real success.
  if (writeError) {
    console.error(`[markObservationProcessed] write failed for ${id}: ${writeError.message}`)
    return { ok: false, writeError: writeError.message }
  }
  return { ok: true }
}

/**
 * Minimal shape markObservationForRetry actually calls -- deliberately
 * loose (matching this file's own existing `any`-cast convention for
 * every real Supabase call) so a test can supply a small hand-written
 * mock without depending on Supabase's full generic client types.
 */
export interface RetryQueryClient {
  from(table: string): {
    select: (columns: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        single: () => Promise<{ data: unknown; error: { message: string } | null }>
      }
    }
    update: (values: Record<string, unknown>) => {
      eq: (
        col: string,
        val: string,
      ) => {
        select: (
          columns: string,
        ) => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>
      }
    }
  }
}

/**
 * Requeues an observation for a later retry attempt. Returns the
 * confirmed-updated row's own id -- callers can treat a resolved
 * Promise as proof the row was actually found and updated, not merely
 * that the request didn't error. Throws if the read, the update
 * itself, or the confirmation (zero rows matched) fails.
 *
 * `client` is optional purely for testability -- every real call site
 * omits it and gets the real createAdminClient(), unchanged.
 */
export async function markObservationForRetry(
  id: string,
  retryAfterMs: number = 60_000,
  client?: RetryQueryClient,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (client ?? createAdminClient()) as any
  const retryAt = new Date(Date.now() + retryAfterMs).toISOString()

  // Real bug fixed here: the previous version wrote
  // `metadata: { retry_after: retryAt }` directly, wholesale replacing
  // the entire metadata JSONB column and silently discarding any other
  // fields already stored there (e.g. feed_url, set by the collector).
  // Read the existing value first and merge, never overwrite.
  const { data: existing, error: readError } = (await supabase
    .from('observations')
    .select('metadata')
    .eq('id', id)
    .single()) as {
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
  // was safely back in the queue). Chaining `.select('id')` after
  // `.update()` returns the actually-affected row(s), so a WHERE clause
  // that silently matched zero rows (wrong id, already deleted, RLS
  // blocked it) is distinguishable from a genuine PostgREST error --
  // Supabase does not itself treat "matched 0 rows" as an error
  // condition, so without this explicit check that case would have
  // continued to look identical to success.
  const { data: updated, error: updateError } = (await supabase
    .from('observations')
    .update({
      processed: false,
      processing_error: null,
      metadata: { ...existingMetadata, retry_after: retryAt },
    })
    .eq('id', id)
    .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null }

  if (updateError) {
    throw new Error(`[markObservationForRetry] failed to requeue ${id}: ${updateError.message}`)
  }

  if (!updated || updated.length === 0) {
    throw new Error(
      `[markObservationForRetry] update matched zero rows for ${id} -- observation may not exist`,
    )
  }

  const confirmedId = updated[0]?.id
  if (!confirmedId) {
    // Defensive: should be unreachable given the length check above,
    // but never fabricate a confirmation id that wasn't actually
    // returned by Supabase.
    throw new Error(`[markObservationForRetry] update response for ${id} did not include a row id`)
  }

  return confirmedId
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
  oldestPendingAgeSeconds: number | null
}> {
  const supabase = createAdminClient()
  const [total, processed, errors, oldestPending] = await Promise.all([
    supabase.from('observations').select('id', { count: 'exact', head: true }),
    supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .eq('processed', true),
    supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .not('processing_error', 'is', null),
    // Real requirement: "oldest pending age" -- queue depth alone
    // (unprocessed count) does not show whether the queue is stuck on
    // old work or genuinely fresh. Oldest unprocessed row's age is the
    // real signal for that.
    supabase
      .from('observations')
      .select('collected_at')
      .eq('processed', false)
      .order('collected_at', { ascending: true })
      .limit(1),
  ])
  const t = total.count ?? 0
  const p = processed.count ?? 0
  const oldestRow = oldestPending.data?.[0] as { collected_at: string } | undefined
  const oldestPendingAgeSeconds = oldestRow
    ? Math.floor((Date.now() - new Date(oldestRow.collected_at).getTime()) / 1000)
    : null
  return {
    total: t,
    processed: p,
    unprocessed: t - p,
    errors: errors.count ?? 0,
    oldestPendingAgeSeconds,
  }
}

/**
 * Source links (URL + source name + favicon candidate) for a signal's
 * observations, for public display.
 *
 * Real gap this closes: signal pages had no way to show WHERE a claim
 * came from beyond a bare count -- the URL, source name, and a
 * same-origin favicon candidate all existed in the database already
 * but were never surfaced together for rendering.
 *
 * Uses the admin client -- RLS is enabled on `observations`/`sources`
 * with no public-read policy (confirmed against production), so the
 * public client can read neither table directly. Selects only the
 * columns needed for display (url, source name) -- never `content`.
 *
 * SAFETY: callers MUST reach this only after getSignalById() has
 * already confirmed the signal is publicly visible through the
 * PUBLIC, RLS-bound client -- a non-public signal 404s before this is
 * ever called, so no observation can be surfaced for a signal the
 * viewer could not already see. This function itself additionally
 * filters out unsafe URLs (see src/lib/utils/source-links.ts) before
 * returning, so an unsafe link can never reach the rendering layer at
 * all -- it does not decide whether to hide the whole signal (that
 * decision belongs to the caller, per the "no safe links -> do not
 * publish" requirement), it only ever returns the safe subset.
 */
export async function getSourceLinksForSignal(observationIds: string[]): Promise<SourceLink[]> {
  if (observationIds.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('observations')
    .select('url, source_id, sources(name)')
    .in('id', observationIds)

  if (error) {
    console.error('[observations/queries] getSourceLinksForSignal error:', error.message)
    return []
  }

  const raw = (data ?? []) as Array<{
    url: string | null
    source_id: string | null
    sources: { name: string } | { name: string }[] | null
  }>

  const links: SourceLink[] = raw
    .filter((row): row is typeof row & { url: string } => Boolean(row.url))
    .map((row) => {
      const sourcesField = row.sources
      const sourceName = Array.isArray(sourcesField)
        ? (sourcesField[0]?.name ?? 'Unknown source')
        : (sourcesField?.name ?? 'Unknown source')
      return {
        url: row.url,
        sourceName,
        faviconUrl: buildFaviconUrl(row.url),
      }
    })

  // Unsafe links are excluded HERE, at the data layer -- see this
  // function's own docstring: the caller only ever sees the safe
  // subset, and a caller implementing "no safe links -> do not
  // publish" only needs to check whether the returned array is empty.
  return filterSafeSourceLinks(links)
}
