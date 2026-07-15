import type { Metadata } from 'next'
import { Pulse } from '@/components/ui/pulse'
import { getMockSignalStats, getMockSignals } from '@/modules/signals/mock'
import { formatCategory } from '@/lib/utils/format'
import { getSignalSeverity } from '@/types/database'
import type { SignalCategory } from '@/types/database'

export const metadata: Metadata = {
  title: 'Observatory',
  description: 'Global AI ecosystem activity dashboard — signal radar, category distribution, Observatory metrics.',
}

export const revalidate = 3600

const CATEGORY_EXPIRY_DAYS: Record<SignalCategory, number> = {
  RESEARCH: 90, MODELS: 60, COMPANIES: 45, INFRASTRUCTURE: 60,
  OPEN_SOURCE: 45, FUNDING: 30, REGULATION: 120, AGENTS: 45, HARDWARE: 90,
}

export default function ObservatoryPage(): React.JSX.Element {
  const stats = getMockSignalStats()
  const signals = getMockSignals({ limit: 50 })

  const severityBreakdown = {
    CRITICAL: signals.filter((s) => getSignalSeverity(s.signal_score) === 'CRITICAL').length,
    HIGH:     signals.filter((s) => getSignalSeverity(s.signal_score) === 'HIGH').length,
    MEDIUM:   signals.filter((s) => getSignalSeverity(s.signal_score) === 'MEDIUM').length,
    LOW:      signals.filter((s) => getSignalSeverity(s.signal_score) === 'LOW').length,
  }

  const avgScores = signals.length > 0 ? {
    signal:     Math.round(signals.reduce((a, s) => a + s.signal_score, 0) / signals.length),
    confidence: Math.round(signals.reduce((a, s) => a + s.confidence_score, 0) / signals.length),
    momentum:   Math.round(signals.reduce((a, s) => a + s.momentum_score, 0) / signals.length),
  } : { signal: 0, confidence: 0, momentum: 0 }

  return (
    <div className="mx-auto max-w-7xl">

      {/* Header */}
      <div className="border-b border-observatory-border px-6 py-8">
        <div className="mb-2 flex items-center gap-3">
          <Pulse size="md" />
          <p className="font-mono text-xs tracking-wider text-text-muted">GLOBAL MONITORING</p>
        </div>
        <h1 className="text-2xl font-light text-text-primary">Observatory Dashboard</h1>
        <p className="mt-2 text-sm text-text-muted">
          System-wide monitoring of AI ecosystem signal activity and Observatory health.
        </p>
      </div>

      {/* Top metrics */}
      <div className="grid border-b border-observatory-border grid-cols-2 md:grid-cols-4">
        <MetricCell label="Total Signals"  value={stats.total}           />
        <MetricCell label="Critical"       value={severityBreakdown.CRITICAL} accent />
        <MetricCell label="Avg Signal Score" value={`${avgScores.signal}/100`} />
        <MetricCell label="Avg Confidence" value={`${avgScores.confidence}%`} />
      </div>

      <div className="grid gap-px bg-observatory-border md:grid-cols-2">

        {/* Signal severity distribution */}
        <section className="bg-observatory-black p-6">
          <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">
            SEVERITY DISTRIBUTION
          </h2>
          <div className="space-y-3">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => {
              const count = severityBreakdown[sev]
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
              const colors: Record<string, string> = {
                CRITICAL: 'bg-text-primary',
                HIGH:     'bg-signal-high',
                MEDIUM:   'bg-signal-medium',
                LOW:      'bg-signal-low',
              }
              return (
                <div key={sev} className="flex items-center gap-3">
                  <span className="w-16 font-mono text-xs text-text-muted">{sev}</span>
                  <div className="h-px flex-1 bg-observatory-border">
                    <div className={`h-px ${colors[sev]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono text-xs tabular-nums text-text-secondary">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {/* Category activity */}
        <section className="bg-observatory-black p-6">
          <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">
            CATEGORY ACTIVITY
          </h2>
          <div className="space-y-2.5">
            {Object.entries(stats.byCategory)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, count]) => {
                const category = cat as SignalCategory
                const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <span className="w-24 font-mono text-xs text-text-muted truncate">
                      {cat.replace('_', ' ')}
                    </span>
                    <div className="h-px flex-1 bg-observatory-border">
                      <div className="h-px bg-text-muted" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-6 text-right font-mono text-xs tabular-nums text-text-secondary">
                      {count}
                    </span>
                  </div>
                )
              })}
          </div>
        </section>

        {/* Observatory health */}
        <section className="bg-observatory-black p-6">
          <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">
            OBSERVATORY HEALTH
          </h2>
          <div className="space-y-3">
            {[
              { label: 'Signal Engine',      status: 'STAGE 7', active: false },
              { label: 'Observation Layer',  status: 'STAGE 6', active: false },
              { label: 'Event Generator',    status: 'STAGE 8', active: false },
              { label: 'Content Agent',      status: 'STAGE 9', active: false },
              { label: 'Knowledge Agent',    status: 'STAGE 12', active: false },
              { label: 'Observatory Assistant', status: 'STAGE 13', active: false },
            ].map(({ label, status, active }) => (
              <div key={label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pulse size="sm" active={active} />
                  <span className="text-xs text-text-muted">{label}</span>
                </div>
                <span className="font-mono text-xs text-text-muted">{status}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Score averages */}
        <section className="bg-observatory-black p-6">
          <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">
            SCORE AVERAGES
          </h2>
          <div className="space-y-4">
            {[
              { label: 'Signal Score',     value: avgScores.signal },
              { label: 'Confidence Score', value: avgScores.confidence },
              { label: 'Momentum Score',   value: avgScores.momentum },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="mb-1.5 flex justify-between font-mono text-xs text-text-muted">
                  <span>{label}</span>
                  <span>{value}/100</span>
                </div>
                <div className="h-px bg-observatory-border">
                  <div className="h-px bg-text-secondary" style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function MetricCell({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: boolean
}): React.JSX.Element {
  return (
    <div className="border-r border-observatory-border px-6 py-5 last:border-r-0">
      <p className="mb-1 font-mono text-xs text-text-muted">{label.toUpperCase()}</p>
      <p className={`font-mono text-2xl tabular-nums ${accent ? 'text-text-primary' : 'text-text-secondary'}`}>
        {value}
      </p>
    </div>
  )
}
