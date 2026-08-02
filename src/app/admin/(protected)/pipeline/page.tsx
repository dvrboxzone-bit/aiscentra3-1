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

  const pendingRetryObs = (pendingRetryRows.data ?? []).filter((o: Record<string, unknown>) => {
    const retryAfter = (o['metadata'] as RetryMetadata | null)?.retry_after
    return typeof retryAfter === 'string' && retryAfter.length > 0
  })

  const now = new Date()
  const dueNow = pendingRetryObs.filter((o: Record<string, unknown>) => {
    const retryAfter = (o['metadata'] as RetryMetadata).retry_after
    return retryAfter !== undefined && new Date(retryAfter) <= now
  })

  return (
    <div className="space-y-8">
      <div>
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">PIPELINE MONITORING</p>
        <h1 className="text-2xl font-light text-text-primary">Pipeline Status</h1>
      </div>

      {/* 24h metrics */}
      <div>
        <p className="mb-3 font-mono text-xs tracking-wider text-text-muted">LAST 24 HOURS</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {[
            { label: 'Observations', value: obs24h.count ?? 0 },
            { label: 'Signals Created', value: sigs24h.count ?? 0 },
            { label: 'Events Promoted', value: events24h.count ?? 0 },
            {
              label: 'Unprocessed Queue',
              value: unprocessed.count ?? 0,
              alert: (unprocessed.count ?? 0) > 20,
            },
            {
              label: 'Processing Errors',
              value: withErrors.count ?? 0,
              alert: (withErrors.count ?? 0) > 0,
            },
            { label: 'Pending Retry', value: pendingRetryObs.length, alert: dueNow.length > 0 },
            { label: 'Total Observations', value: totalObs.count ?? 0 },
          ].map(({ label, value, alert }) => (
            <div
              key={label}
              className="border border-observatory-border bg-observatory-surface p-4"
            >
              <p className="mb-1 font-mono text-xs text-text-muted">{label.toUpperCase()}</p>
              <p
                className={`font-mono text-2xl tabular-nums ${alert ? 'text-amber-400' : 'text-text-secondary'}`}
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
      {pendingRetryObs.length > 0 && (
        <div>
          <p className="mb-3 font-mono text-xs tracking-wider text-text-muted">
            PENDING RETRY ({pendingRetryObs.length}, {dueNow.length} due now)
          </p>
          <div className="divide-y divide-observatory-border border border-observatory-border">
            <div className="grid grid-cols-[1fr_140px_100px] gap-4 bg-observatory-surface px-4 py-2">
              {['TITLE', 'RETRY AFTER', 'COLLECTED'].map((h) => (
                <span key={h} className="font-mono text-xs text-text-muted">
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
                  <p className="truncate text-xs text-text-secondary">{obs['title'] as string}</p>
                  <span
                    className={`font-mono text-xs ${isDue ? 'text-amber-400' : 'text-text-muted'}`}
                  >
                    {isDue ? 'DUE NOW' : formatRelativeTime(retryAfter)}
                  </span>
                  <span className="font-mono text-xs text-text-muted">
                    {formatRelativeTime(obs['collected_at'] as string)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent observations */}
      <div>
        <p className="mb-3 font-mono text-xs tracking-wider text-text-muted">RECENT OBSERVATIONS</p>
        <div className="divide-y divide-observatory-border border border-observatory-border">
          <div className="grid grid-cols-[1fr_80px_100px] gap-4 bg-observatory-surface px-4 py-2">
            {['TITLE', 'STATUS', 'COLLECTED'].map((h) => (
              <span key={h} className="font-mono text-xs text-text-muted">
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
                <p className="truncate text-xs text-text-secondary">{obs['title'] as string}</p>
                <span
                  className={`font-mono text-xs ${
                    obs['processed'] ? 'text-text-secondary' : 'text-amber-400'
                  }`}
                >
                  {label}
                </span>
                <span className="font-mono text-xs text-text-muted">
                  {formatRelativeTime(obs['collected_at'] as string)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Errors */}
      {(recentErrors.data ?? []).length > 0 && (
        <div>
          <p className="mb-3 font-mono text-xs tracking-wider text-amber-400">PROCESSING ERRORS</p>
          <div className="divide-y divide-observatory-border border border-amber-400/20">
            {(recentErrors.data ?? []).map((obs: Record<string, unknown>) => (
              <div key={obs['id'] as string} className="px-4 py-3">
                <p className="mb-1 truncate text-xs text-text-secondary">
                  {obs['title'] as string}
                </p>
                <p className="font-mono text-xs text-amber-400">
                  {(obs['processing_error'] as string).slice(0, 120)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
