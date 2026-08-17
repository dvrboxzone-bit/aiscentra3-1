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
    </div>
  )
}
