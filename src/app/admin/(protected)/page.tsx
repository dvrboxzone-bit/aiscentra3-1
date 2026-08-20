/**
 * AIscentra — Admin Dashboard
 *
 * Recovered from an early project archive (Readiness Assessment Blocker
 * B-02, resolved 2026-07-19) that predates Signal Engine V2 and was
 * never carried forward into the current codebase. Adapted here to the
 * current V2 schema and current pipeline architecture (daily Vercel
 * cron + hourly GitHub Actions enrich/batch trigger) rather than the
 * archive's original fictional four-times-daily cron schedule.
 *
 * Frontend Design Foundation, layer 6: every real query
 * (sources/observations/signals/events/reports counts, 24h windows,
 * unprocessed/error/pendingRetry/severity computations) is completely
 * UNCHANGED -- only the visual JSX is migrated to vfinal.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { getSignalSeverity } from '@/types/database'

export const dynamic = 'force-dynamic'

interface CountRow {
  status?: string
  signal_score?: number
  processed?: boolean
  processing_error?: string | null
  metadata?: Record<string, unknown> | null
}

export default async function AdminDashboard(): Promise<React.JSX.Element> {
  const supabase = createAdminClient()

  const [sources, observations, signals, events, reports] = await Promise.all([
    supabase.from('sources').select('id, status', { count: 'exact' }),
    supabase
      .from('observations')
      .select('id, processed, processing_error, metadata', { count: 'exact' }),
    supabase.from('signals').select('id, status, signal_score', { count: 'exact' }),
    supabase.from('events').select('id', { count: 'exact' }),
    supabase.from('reports').select('id', { count: 'exact' }).not('published_at', 'is', null),
  ])

  const obsRows = (observations.data ?? []) as CountRow[]
  const unprocessed = obsRows.filter((o) => !o.processed).length
  const withError = obsRows.filter(
    (o) => o.processing_error !== null && o.processing_error !== undefined,
  ).length
  const pendingRetry = obsRows.filter((o) => {
    const retryAfter = (o.metadata as { retry_after?: string } | null)?.retry_after
    return typeof retryAfter === 'string' && retryAfter.length > 0
  }).length

  const signalRows = (signals.data ?? []) as CountRow[]
  const activeSignals = signalRows.filter((s) => s.status === 'ACTIVE').length
  const criticalSignals = signalRows.filter(
    (s) => s.status === 'ACTIVE' && getSignalSeverity(s.signal_score ?? 0) === 'CRITICAL',
  ).length

  const since24h = new Date(Date.now() - 86400000).toISOString()
  const { count: obs24h } = await supabase
    .from('observations')
    .select('id', { count: 'exact', head: true })
    .gte('collected_at', since24h)

  const { count: sigs24h } = await supabase
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since24h)

  const metrics: Array<{ label: string; value: number; alert?: boolean; highlight?: boolean }> = [
    {
      label: 'Active Sources',
      value: (sources.data ?? []).filter((s: { status: string }) => s.status === 'ACTIVE').length,
    },
    { label: 'Unprocessed Obs', value: unprocessed, alert: unprocessed > 20 },
    { label: 'Processing Errors', value: withError, alert: withError > 0 },
    { label: 'Pending Retry', value: pendingRetry },
    { label: 'Active Signals', value: activeSignals },
    { label: 'Critical Signals', value: criticalSignals, highlight: true },
    { label: 'Total Observations', value: observations.count ?? 0 },
    { label: 'Obs (24h)', value: obs24h ?? 0 },
    { label: 'Signals (24h)', value: sigs24h ?? 0 },
    { label: 'Events', value: events.count ?? 0 },
    { label: 'Reports Published', value: reports.count ?? 0 },
  ]

  return (
    <div>
      <div className="mb-8">
        <span className="font-caption mb-1 block text-mint-signal">ADMIN DASHBOARD</span>
        <h1 className="font-heading text-2xl text-frost">Observatory Status</h1>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(({ label, value, alert, highlight }) => (
          <div key={label} className="border border-border-subtle bg-surface-tonal p-4">
            <p className="font-caption mb-1 text-silver-haze">{label.toUpperCase()}</p>
            <p
              className={`font-mono text-2xl tabular-nums ${
                alert ? 'text-amber-400' : highlight ? 'text-frost' : 'text-silver-haze'
              }`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Pipeline schedule — reflects the ACTUAL current trigger setup,
          not a fictional schedule. See docs/ops/MIGRATION_RECONCILIATION_*
          and the GitHub Actions workflow for the authoritative source. */}
      <div>
        <span className="font-caption mb-3 block text-silver-haze">PIPELINE TRIGGERS (UTC)</span>
        <div className="divide-y divide-border-subtle border border-border-subtle bg-surface-tonal">
          {[
            {
              time: 'Daily 10:00',
              job: 'Full Pipeline (collect → enrich → events → reports)',
              endpoint: '/api/cron/pipeline (Vercel Cron)',
            },
            {
              time: 'Hourly :00',
              job: 'Enrich Batch (throughput trigger, free-tier structural fix)',
              endpoint: '/api/enrich/batch (GitHub Actions schedule)',
            },
          ].map(({ time, job, endpoint }) => (
            <div key={endpoint} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-4">
                <span className="font-caption w-28 shrink-0 text-silver-haze">{time}</span>
                <span className="text-sm text-silver-haze">{job}</span>
              </div>
              <span className="font-caption text-silver-haze">{endpoint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
