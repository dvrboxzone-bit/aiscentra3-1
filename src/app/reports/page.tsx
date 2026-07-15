import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Reports',
  description: 'Intelligence publications — signal briefs, event analyses, weekly reviews and trend reports.',
}

export const revalidate = 3600

const REPORT_TYPES = [
  { type: 'SIGNAL_BRIEF',    label: 'Signal Brief',    desc: 'Concise analysis of a single high-significance signal.' },
  { type: 'EVENT_ANALYSIS',  label: 'Event Analysis',  desc: 'Deep interpretation of a promoted ecosystem event.' },
  { type: 'WEEKLY_REVIEW',   label: 'Weekly Review',   desc: 'Synthesis of the week\'s significant signals and events.' },
  { type: 'TREND_REPORT',    label: 'Trend Report',    desc: 'Pattern analysis across signal categories over time.' },
]

export default function ReportsPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="border-b border-observatory-border px-6 py-8">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">INTELLIGENCE PUBLICATIONS</p>
        <h1 className="text-2xl font-light text-text-primary">Reports</h1>
        <p className="mt-2 text-sm text-text-muted">
          Intelligence generated from Observatory signals and events.
        </p>
      </div>

      <div className="grid border-b border-observatory-border md:grid-cols-4">
        {REPORT_TYPES.map(({ type, label, desc }) => (
          <div key={type} className="border-r border-observatory-border p-6 last:border-r-0">
            <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">{type}</p>
            <p className="mb-2 font-medium text-text-primary">{label}</p>
            <p className="text-xs leading-relaxed text-text-muted">{desc}</p>
          </div>
        ))}
      </div>

      <div className="px-6 py-16 text-center">
        <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">BUILD ORDER STAGE 9</p>
        <h2 className="mb-3 text-lg font-light text-text-primary">Content Intelligence Layer Initializing</h2>
        <p className="mx-auto max-w-md text-sm text-text-muted">
          Reports are generated automatically by the Content Agent after the Event Engine
          promotes signals. The first Weekly Review will publish once sufficient events
          have been detected.
        </p>
      </div>
    </div>
  )
}
