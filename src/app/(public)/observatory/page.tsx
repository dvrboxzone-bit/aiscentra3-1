import type { Metadata } from 'next'
import { Pulse } from '@/components/ui/pulse'
import { getSignals, getSignalStats } from '@/modules/signals/queries'
import { getEvents } from '@/modules/events/queries'
import { getReports } from '@/modules/reports/queries'
import { getObservationStats } from '@/modules/observations/queries'
import { getSignalSeverity } from '@/types/database'

export const metadata: Metadata = {
  title: 'Observatory',
  description:
    "A live view of what AIscentra is watching right now — sources checked, signals in review, and what cleared the evidence bar today versus what didn't.",
}

export const revalidate = 3600

/**
 * AIscentra — vfinal /observatory page (Frontend Design Foundation,
 * layer 5C). Real getSignalStats, getSignals, getEvents, getReports,
 * getObservationStats queries, severity breakdown, avgScores
 * computation, Pulse component, system-status list, empty states --
 * all unchanged. Visual language migrated to vfinal.
 */
export default async function ObservatoryPage(): Promise<React.JSX.Element> {
  const [stats, signals, events, , obsStats] = await Promise.all([
    getSignalStats(),
    getSignals({ limit: 100 }),
    getEvents({ limit: 20 }),
    getReports(undefined, 10),
    getObservationStats(),
  ])

  const severityBreakdown = {
    CRITICAL: signals.filter((s) => getSignalSeverity(s.signal_score) === 'CRITICAL').length,
    HIGH: signals.filter((s) => getSignalSeverity(s.signal_score) === 'HIGH').length,
    MEDIUM: signals.filter((s) => getSignalSeverity(s.signal_score) === 'MEDIUM').length,
    LOW: signals.filter((s) => getSignalSeverity(s.signal_score) === 'LOW').length,
  }

  const avgScores =
    signals.length > 0
      ? {
          signal: Math.round(signals.reduce((a, s) => a + s.signal_score, 0) / signals.length),
          confidence: Math.round(
            signals.reduce((a, s) => a + s.confidence_score, 0) / signals.length,
          ),
          momentum: Math.round(signals.reduce((a, s) => a + s.momentum_score, 0) / signals.length),
        }
      : { signal: 0, confidence: 0, momentum: 0 }

  return (
    <>
      <div className="textured-bg relative px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <div className="mb-2 flex items-center gap-3">
            <Pulse size="md" />
            <span className="font-caption text-mint-signal">GLOBAL MONITORING</span>
          </div>
          <h1 className="font-display mb-12 text-[12vw] text-frost md:text-[80px]">
            Observatory Dashboard.
          </h1>

          <div className="mb-px grid grid-cols-2 border border-border-subtle bg-deep-obsidian md:grid-cols-4">
            <MetricCell label="Observations" value={obsStats.total} />
            <MetricCell label="Signals" value={stats.total} />
            <MetricCell label="Critical" value={severityBreakdown.CRITICAL} accent />
            <MetricCell label="Events" value={events.length} />
          </div>

          <div className="grid gap-px border-x border-b border-border-subtle bg-border-subtle md:grid-cols-2">
            <section className="bg-surface-tonal p-6">
              <h2 className="font-caption mb-4 text-silver-haze">SEVERITY DISTRIBUTION</h2>
              <div className="space-y-3">
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => {
                  const count = severityBreakdown[sev]
                  const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
                  const colors: Record<string, string> = {
                    CRITICAL: 'bg-frost',
                    HIGH: 'bg-mint-signal',
                    MEDIUM: 'bg-silver-haze',
                    LOW: 'bg-border-subtle',
                  }
                  return (
                    <div key={sev} className="flex items-center gap-3">
                      <span className="font-caption w-16 text-silver-haze">{sev}</span>
                      <div className="h-px flex-1 bg-border-subtle">
                        <div className={`h-px ${colors[sev]}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-6 text-right font-mono text-xs tabular-nums text-frost">
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="bg-surface-tonal p-6">
              <h2 className="font-caption mb-4 text-silver-haze">CATEGORY ACTIVITY</h2>
              {Object.keys(stats.byCategory).length === 0 ? (
                <p className="text-xs text-silver-haze">No signals yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(stats.byCategory)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, count]) => {
                      const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
                      return (
                        <div key={cat} className="flex items-center gap-3">
                          <span className="font-caption w-24 truncate text-silver-haze">
                            {cat.replace('_', ' ')}
                          </span>
                          <div className="h-px flex-1 bg-border-subtle">
                            <div className="h-px bg-silver-haze" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-6 text-right font-mono text-xs tabular-nums text-frost">
                            {count}
                          </span>
                        </div>
                      )
                    })}
                </div>
              )}
            </section>

            <section className="bg-surface-tonal p-6">
              <h2 className="font-caption mb-4 text-silver-haze">SYSTEM STATUS</h2>
              <div className="space-y-3">
                {[
                  { label: 'Database', active: true, status: 'CONNECTED' },
                  {
                    label: 'Observation Layer',
                    active: obsStats.errors > 0,
                    status: obsStats.errors > 0 ? `${obsStats.errors} TODAY` : 'STAGE 6',
                  },
                  {
                    label: 'Pipeline Queue',
                    active: obsStats.unprocessed > 0,
                    status: `${obsStats.unprocessed} PENDING`,
                  },
                  { label: 'Signal Engine', active: false, status: 'STAGE 7' },
                  { label: 'Event Generator', active: false, status: 'STAGE 8' },
                  { label: 'Content Agent', active: false, status: 'STAGE 9' },
                  { label: 'Assistant', active: false, status: 'STAGE 13' },
                ].map(({ label, active, status }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Pulse size="sm" active={active} />
                      <span className="text-xs text-silver-haze">{label}</span>
                    </div>
                    <span
                      className={`font-mono text-xs ${active ? 'text-frost' : 'text-silver-haze'}`}
                    >
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-surface-tonal p-6">
              <h2 className="font-caption mb-4 text-silver-haze">SCORE AVERAGES</h2>
              <div className="space-y-4">
                {[
                  { label: 'Signal Score', value: avgScores.signal },
                  { label: 'Confidence Score', value: avgScores.confidence },
                  { label: 'Momentum Score', value: avgScores.momentum },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="font-caption mb-1.5 flex justify-between text-silver-haze">
                      <span>{label}</span>
                      <span>{value}/100</span>
                    </div>
                    <div className="h-px bg-border-subtle">
                      <div
                        className="h-px bg-mint-signal transition-all"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}

function MetricCell({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: boolean
}): React.JSX.Element {
  return (
    <div className="border-r border-border-subtle bg-surface-tonal px-6 py-5 last:border-r-0">
      <p className="font-caption mb-1 text-silver-haze">{label.toUpperCase()}</p>
      <p
        className={`font-mono text-2xl tabular-nums ${accent ? 'text-frost' : 'text-silver-haze'}`}
      >
        {value}
      </p>
    </div>
  )
}
