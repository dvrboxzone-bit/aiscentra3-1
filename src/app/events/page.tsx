import type { Metadata } from 'next'
import { formatDate } from '@/lib/utils/format'

export const metadata: Metadata = {
  title: 'Events',
  description: 'AI ecosystem events — significant developments promoted from the signal feed.',
}

export const revalidate = 3600

// Stage 5 placeholder — Event Engine (Stage 8) populates this
const COMING_SOON_EVENTS = [
  { label: 'Model Launches', count: 0 },
  { label: 'Funding Rounds', count: 0 },
  { label: 'Strategic Shifts', count: 0 },
  { label: 'Regulatory Developments', count: 0 },
  { label: 'Research Breakthroughs', count: 0 },
]

export default function EventsPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="border-b border-observatory-border px-6 py-8">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">EVENT MONITORING</p>
        <h1 className="text-2xl font-light text-text-primary">Events</h1>
        <p className="mt-2 text-sm text-text-muted">
          Significant developments promoted from the signal feed and enriched with impact analysis.
        </p>
      </div>

      <div className="grid border-b border-observatory-border md:grid-cols-5">
        {COMING_SOON_EVENTS.map(({ label, count }) => (
          <div key={label} className="border-r border-observatory-border px-6 py-6 last:border-r-0">
            <p className="mb-1 font-mono text-2xl tabular-nums text-text-muted">{count}</p>
            <p className="text-xs text-text-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="px-6 py-16 text-center">
        <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">BUILD ORDER STAGE 8</p>
        <h2 className="mb-3 text-lg font-light text-text-primary">Event Engine Initializing</h2>
        <p className="mx-auto max-w-md text-sm text-text-muted">
          Events are created automatically when signals cross promotion thresholds
          (signal_score ≥ 70 and confidence_score ≥ 65). The Event Engine activates
          after the Signal Engine has processed initial observations.
        </p>
      </div>
    </div>
  )
}
