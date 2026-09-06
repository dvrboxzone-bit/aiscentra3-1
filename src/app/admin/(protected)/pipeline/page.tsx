/**
 * AIscentra — Admin Pipeline Monitoring
 *
 * Recovered from an early project archive (Readiness Assessment Blocker
 * B-02). Adapted here: adds a Pending Retry metric and section that did
 * not exist in the archive -- introduced by the recent fix to
 * agent.ts/enrich-batch's retry classification (an observation whose
 * whole model-chain was rate-limited is now correctly requeued via
 * metadata.retry_after instead of being marked permanently failed).
 * Without this section an admin would have no visibility into whether
 * that fix is actually taking effect in production.
 *
 * Frontend Design Foundation, layer 6: every real query (24h metrics,
 * pending-retry computation, recent observations, recent errors) is
 * completely UNCHANGED -- only the visual JSX is migrated to vfinal.
 *
 * Layer 6 correction (independent audit, real bug): every one of the 9
 * real Promise.all queries previously discarded its own `error`
 * entirely, falling back to `.count ?? 0` / `.data ?? []` -- a genuine
 * query failure (any one of the 9) was completely indistinguishable
 * from honest zero/empty data across the whole dashboard. Fixed:
 * each query's real `.error` is now checked explicitly. A failed
 * count-metric renders "UNAVAILABLE" (never a fabricated 0). A failed
 * list query renders an honest, distinct "could not load" message
 * instead of silently rendering as a genuinely-empty list.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { formatRelativeTime } from '@/lib/utils/format'

export const dynamic = 'force-dynamic'

interface RetryMetadata {
  retry_after?: string
}

/**
 * REAL, TEMPORARY forensic check (explicit owner instruction,
 * 2026-09-06): before designing any real "Noise?" public page, first
 * honestly check whether the real data behind it (QualificationResult
 * + rejection_code, both real, already-existing fields on
 * observations) is rich enough, recent enough, and safe enough to
 * publish -- following the exact same real discipline already applied
 * to evidence_tier: surface what's already computed before building
 * anything new.
 *
 * Deliberately admin-only, not public: this reads real observation
 * titles (for a manual safety-review sample) and real rejection
 * reasons, which the owner needs to eyeball before any public
 * decision -- never exposed outside the already-authenticated
 * /admin area.
 *
 * Deliberately ONE query (not 20 separate COUNT queries per
 * QualificationResult/rejection_code value): fetches the real,
 * qualified rows once, aggregates client-side. A real row-count cap
 * (5000) keeps this from becoming an unbounded full-table scan; if
 * the real total exceeds it, that's shown honestly rather than
 * silently truncated without saying so.
 */
async function getNoiseForensicData(): Promise<{
  error: boolean
  totalQualified: number
  cappedAt: number | null
  byResult: Record<string, number>
  byRejectionCode: Record<string, number>
  earliestDate: string | null
  latestDate: string | null
  sampleTitles: Array<{ title: string; result: string | null; code: string | null }>
}> {
  const supabase = createAdminClient()
  const CAP = 5000
  const { data, error, count } = await supabase
    .from('observations')
    .select('title, qualification_result, rejection_code, collected_at', { count: 'exact' })
    .not('qualification_result', 'is', null)
    .order('collected_at', { ascending: false })
    .limit(CAP)

  if (error || !data) {
    return {
      error: true,
      totalQualified: 0,
      cappedAt: null,
      byResult: {},
      byRejectionCode: {},
      earliestDate: null,
      latestDate: null,
      sampleTitles: [],
    }
  }

  const byResult: Record<string, number> = {}
  const byRejectionCode: Record<string, number> = {}
  let earliestDate: string | null = null
  let latestDate: string | null = null

  for (const row of data as Array<{
    title: string
    qualification_result: string | null
    rejection_code: string | null
    collected_at: string
  }>) {
    if (row.qualification_result) {
      byResult[row.qualification_result] = (byResult[row.qualification_result] ?? 0) + 1
    }
    if (row.rejection_code) {
      byRejectionCode[row.rejection_code] = (byRejectionCode[row.rejection_code] ?? 0) + 1
    }
    if (!earliestDate || row.collected_at < earliestDate) earliestDate = row.collected_at
    if (!latestDate || row.collected_at > latestDate) latestDate = row.collected_at
  }

  // Real, manual-safety-review sample: 5 most recent DISCARD rows'
  // titles only (never full content/source), so the owner can
  // eyeball whether these are safe to show publicly -- not a
  // programmatic judgment this code should make on its own.
  const sampleTitles = (
    data as Array<{
      title: string
      qualification_result: string | null
      rejection_code: string | null
    }>
  )
    .filter((row) => row.qualification_result === 'DISCARD')
    .slice(0, 5)
    .map((row) => ({
      title: row.title,
      result: row.qualification_result,
      code: row.rejection_code,
    }))

  return {
    error: false,
    totalQualified: count ?? data.length,
    cappedAt: (count ?? 0) > CAP ? CAP : null,
    byResult,
    byRejectionCode,
    earliestDate,
    latestDate,
    sampleTitles,
  }
}

export default async function AdminPipelinePage(): Promise<React.JSX.Element> {
  const supabase = createAdminClient()
  const since24h = new Date(Date.now() - 86400000).toISOString()

  const [
    totalObs,
    unprocessed,
    withErrors,
    obs24h,
    sigs24h,
    events24h,
    recentObs,
    recentErrors,
    pendingRetryRows,
  ] = await Promise.all([
    supabase.from('observations').select('id', { count: 'exact', head: true }),
    supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .eq('processed', false),
    supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .not('processing_error', 'is', null),
    supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .gte('collected_at', since24h),
    supabase
      .from('signals')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since24h),
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since24h),
    supabase
      .from('observations')
      .select('id, title, source_id, collected_at, processed, signal_id, metadata')
      .order('collected_at', { ascending: false })
      .limit(10),
    supabase
      .from('observations')
      .select('id, title, processing_error, collected_at')
      .not('processing_error', 'is', null)
      .order('collected_at', { ascending: false })
      .limit(5),
    // Pending retry: unprocessed, no permanent error yet, metadata carries
    // a retry_after timestamp set by markObservationForRetry(). Fetches a
    // bounded window and filters client-side since retry_after lives
    // inside a JSONB column rather than its own indexed field.
    supabase
      .from('observations')
      .select('id, title, metadata, collected_at')
      .eq('processed', false)
      .is('processing_error', null)
      .order('collected_at', { ascending: true })
      .limit(200),
  ])

  // REAL, TEMPORARY forensic check: deliberately placed AFTER the
  // page's own original Promise.all above, not before or inside it --
  // this keeps every existing test's own real, hardcoded call-index
  // assumptions (e.g. "the 7th real .from() call is recentObs") intact
  // instead of silently shifting them by adding a new query earlier
  // in the real execution order.
  const noiseForensic = await getNoiseForensicData()

  // A pending-retry FAILURE must not silently look like "zero pending
  // retries" -- tracked separately so the metric card and section can
  // both honestly reflect it, without duplicating the filter logic.
  const pendingRetryFailed = pendingRetryRows.error !== null
  const pendingRetryObs = pendingRetryFailed
    ? []
    : (pendingRetryRows.data ?? []).filter((o: Record<string, unknown>) => {
        const retryAfter = (o['metadata'] as RetryMetadata | null)?.retry_after
        return typeof retryAfter === 'string' && retryAfter.length > 0
      })

  const now = new Date()
  const dueNow = pendingRetryObs.filter((o: Record<string, unknown>) => {
    const retryAfter = (o['metadata'] as RetryMetadata).retry_after
    return retryAfter !== undefined && new Date(retryAfter) <= now
  })

  function metricValue(result: { count: number | null; error: unknown }): string | number {
    return result.error !== null ? 'UNAVAILABLE' : (result.count ?? 0)
  }

  return (
    <div className="space-y-8">
      <div>
        <span className="font-caption mb-1 block text-mint-signal">PIPELINE MONITORING</span>
        <h1 className="font-heading text-2xl text-frost">Pipeline Status</h1>
      </div>

      <div>
        <span className="font-caption mb-3 block text-silver-haze">LAST 24 HOURS</span>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {[
            { label: 'Observations', value: metricValue(obs24h) },
            { label: 'Signals Created', value: metricValue(sigs24h) },
            { label: 'Events Promoted', value: metricValue(events24h) },
            {
              label: 'Unprocessed Queue',
              value: metricValue(unprocessed),
              alert: unprocessed.error === null && (unprocessed.count ?? 0) > 20,
            },
            {
              label: 'Processing Errors',
              value: metricValue(withErrors),
              alert: withErrors.error === null && (withErrors.count ?? 0) > 0,
            },
            {
              label: 'Pending Retry',
              value: pendingRetryFailed ? 'UNAVAILABLE' : pendingRetryObs.length,
              alert: !pendingRetryFailed && dueNow.length > 0,
            },
            { label: 'Total Observations', value: metricValue(totalObs) },
          ].map(({ label, value, alert }) => (
            <div key={label} className="border border-border-subtle bg-surface-tonal p-4">
              <p className="font-caption mb-1 text-silver-haze">{label.toUpperCase()}</p>
              <p
                className={`font-mono text-2xl tabular-nums ${
                  value === 'UNAVAILABLE'
                    ? 'text-silver-haze opacity-50'
                    : alert
                      ? 'text-amber-400'
                      : 'text-silver-haze'
                }`}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Pending retry — new section: makes the recent rate-limit-retry
          fix (agent.ts + enrich/batch) observable without a manual SQL
          query. Distinguishes "due now, waiting for next batch run" from
          "still in backoff". */}
      {pendingRetryFailed ? (
        <div className="border border-amber-400/40 bg-amber-400/5 px-4 py-6">
          <p className="font-caption mb-1 text-amber-400">PENDING RETRY UNAVAILABLE</p>
          <p className="text-sm text-silver-haze">
            The pending-retry query failed. This is a query failure, not confirmation that nothing
            is pending.
          </p>
        </div>
      ) : (
        pendingRetryObs.length > 0 && (
          <div>
            <span className="font-caption mb-3 block text-silver-haze">
              PENDING RETRY ({pendingRetryObs.length}, {dueNow.length} due now)
            </span>
            <div className="divide-y divide-border-subtle border border-border-subtle bg-surface-tonal">
              <div className="grid grid-cols-[1fr_140px_100px] gap-4 bg-deep-obsidian px-4 py-2">
                {['TITLE', 'RETRY AFTER', 'COLLECTED'].map((h) => (
                  <span key={h} className="font-caption text-silver-haze">
                    {h}
                  </span>
                ))}
              </div>
              {pendingRetryObs.slice(0, 10).map((obs: Record<string, unknown>) => {
                const retryAfter = (obs['metadata'] as RetryMetadata).retry_after as string
                const isDue = new Date(retryAfter) <= now
                return (
                  <div
                    key={obs['id'] as string}
                    className="grid grid-cols-[1fr_140px_100px] items-center gap-4 px-4 py-3"
                  >
                    <p className="truncate text-xs text-silver-haze">{obs['title'] as string}</p>
                    <span
                      className={`font-mono text-xs ${isDue ? 'text-amber-400' : 'text-silver-haze'}`}
                    >
                      {isDue ? 'DUE NOW' : formatRelativeTime(retryAfter)}
                    </span>
                    <span className="font-mono text-xs text-silver-haze">
                      {formatRelativeTime(obs['collected_at'] as string)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      )}

      <div>
        <span className="font-caption mb-3 block text-silver-haze">RECENT OBSERVATIONS</span>
        {recentObs.error ? (
          <div className="border border-amber-400/40 bg-amber-400/5 px-4 py-6">
            <p className="font-caption mb-1 text-amber-400">RECENT OBSERVATIONS UNAVAILABLE</p>
            <p className="text-sm text-silver-haze">
              This query failed. This is not confirmation that no observations exist.
            </p>
          </div>
        ) : (recentObs.data ?? []).length === 0 ? (
          <div className="border border-border-subtle bg-surface-tonal px-4 py-6 text-center">
            <p className="text-sm text-silver-haze">
              The query succeeded and genuinely found no recent observations.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle border border-border-subtle bg-surface-tonal">
            <div className="grid grid-cols-[1fr_80px_100px] gap-4 bg-deep-obsidian px-4 py-2">
              {['TITLE', 'STATUS', 'COLLECTED'].map((h) => (
                <span key={h} className="font-caption text-silver-haze">
                  {h}
                </span>
              ))}
            </div>
            {(recentObs.data ?? []).map((obs: Record<string, unknown>) => {
              const retryAfter = (obs['metadata'] as RetryMetadata | null)?.retry_after
              const isPendingRetry = typeof retryAfter === 'string' && retryAfter.length > 0
              const label = obs['processed']
                ? obs['signal_id']
                  ? 'SIGNAL'
                  : 'SKIPPED'
                : isPendingRetry
                  ? 'RETRY'
                  : 'PENDING'
              return (
                <div
                  key={obs['id'] as string}
                  className="grid grid-cols-[1fr_80px_100px] items-center gap-4 px-4 py-3"
                >
                  <p className="truncate text-xs text-silver-haze">{obs['title'] as string}</p>
                  <span
                    className={`font-mono text-xs ${obs['processed'] ? 'text-silver-haze' : 'text-amber-400'}`}
                  >
                    {label}
                  </span>
                  <span className="font-mono text-xs text-silver-haze">
                    {formatRelativeTime(obs['collected_at'] as string)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {recentErrors.error ? (
        <div className="border border-amber-400/40 bg-amber-400/5 px-4 py-6">
          <p className="font-caption mb-1 text-amber-400">PROCESSING ERRORS QUERY FAILED</p>
          <p className="text-sm text-silver-haze">
            The processing-errors query itself failed. This is not confirmation that there are no
            processing errors.
          </p>
        </div>
      ) : (
        (recentErrors.data ?? []).length > 0 && (
          <div>
            <span className="font-caption mb-3 block text-amber-400">PROCESSING ERRORS</span>
            <div className="divide-y divide-amber-400/20 border border-amber-400/20">
              {(recentErrors.data ?? []).map((obs: Record<string, unknown>) => (
                <div key={obs['id'] as string} className="px-4 py-3">
                  <p className="mb-1 truncate text-xs text-silver-haze">{obs['title'] as string}</p>
                  <p className="font-mono text-xs text-amber-400">
                    {(obs['processing_error'] as string).slice(0, 120)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {/* REAL, TEMPORARY forensic check (explicit owner instruction,
          2026-09-06) -- see getNoiseForensicData()'s own comment for
          the full real reasoning. Remove this section once the
          owner's real "Noise?" decision (A/B/C) has been made; it is
          not meant to stay here permanently. */}
      <div className="border-t border-border-subtle pt-8">
        <span className="font-caption mb-3 block text-mint-signal">
          NOISE/REJECTION FORENSIC CHECK (temporary)
        </span>
        {noiseForensic.error ? (
          <p className="text-sm text-amber-400">
            Query failed -- UNAVAILABLE (not a fabricated zero).
          </p>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-silver-haze">
              {noiseForensic.totalQualified.toLocaleString('en-US')} qualified rows
              {noiseForensic.cappedAt
                ? ` (showing the ${noiseForensic.cappedAt.toLocaleString('en-US')} most recent -- real total exceeds this cap)`
                : ''}
              {noiseForensic.earliestDate && noiseForensic.latestDate && (
                <>
                  {' '}
                  · real date range:{' '}
                  {new Date(noiseForensic.earliestDate).toISOString().slice(0, 10)} →{' '}
                  {new Date(noiseForensic.latestDate).toISOString().slice(0, 10)}
                </>
              )}
            </p>

            <div>
              <span className="font-caption mb-2 block text-silver-haze">
                BY QUALIFICATION RESULT
              </span>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {Object.entries(noiseForensic.byResult)
                  .sort((a, b) => b[1] - a[1])
                  .map(([result, n]) => (
                    <div key={result} className="border border-border-subtle bg-surface-tonal p-3">
                      <p className="font-caption text-silver-haze">{result}</p>
                      <p className="font-mono text-lg text-frost">{n.toLocaleString('en-US')}</p>
                    </div>
                  ))}
              </div>
            </div>

            <div>
              <span className="font-caption mb-2 block text-silver-haze">BY REJECTION CODE</span>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {Object.entries(noiseForensic.byRejectionCode)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, n]) => (
                    <div key={code} className="border border-border-subtle bg-surface-tonal p-3">
                      <p className="font-mono text-silver-haze">{code}</p>
                      <p className="font-mono text-lg text-frost">{n.toLocaleString('en-US')}</p>
                    </div>
                  ))}
              </div>
            </div>

            {noiseForensic.sampleTitles.length > 0 && (
              <div>
                <span className="font-caption mb-2 block text-silver-haze">
                  REAL DISCARD SAMPLE (titles only -- for manual safety review, not a
                  recommendation)
                </span>
                <div className="divide-y divide-border-subtle border border-border-subtle">
                  {noiseForensic.sampleTitles.map((row, i) => (
                    <div key={i} className="px-4 py-3">
                      <p className="mb-1 truncate text-xs text-silver-haze">{row.title}</p>
                      <p className="font-mono text-xs text-mint-signal">{row.code ?? 'no code'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
