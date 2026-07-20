import type { Metadata } from 'next'
import { getEvents } from '@/modules/events/queries'
import { formatRelativeTime } from '@/lib/utils/format'
import type { EventType } from '@/types/database'

export const metadata: Metadata = {
  title: 'Events',
  description: 'AI ecosystem events — significant developments promoted from the Observatory signal feed.',
}

export const revalidate = 3600

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  LAUNCH:                 'Launch',
  PARTNERSHIP:            'Partnership',
  RESEARCH_BREAKTHROUGH:  'Research',
  FUNDING:                'Funding',
  ACQUISITION:            'Acquisition',
  INFRASTRUCTURE_CHANGE:  'Infrastructure',
  REGULATORY_DEVELOPMENT: 'Regulation',
  STRATEGIC_SHIFT:        'Strategic Shift',
}

export default async function EventsPage(): Promise<React.JSX.Element> {
  const events = await getEvents({ limit: 30 })

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header */}
      <div className="border-b border-observatory-border px-6 py-8">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">EVENT MONITORING</p>
        <h1 className="text-2xl font-light text-text-primary">Events</h1>
        <p className="mt-2 text-sm text-text-muted">
          {events.length > 0
            ? `${events.length} ecosystem event${events.length !== 1 ? 's' : ''} detected`
            : 'Events appear when signals cross promotion thresholds (score ≥ 70, confidence ≥ 65)'}
        </p>
      </div>

      {/* Event type counts */}
      {events.length > 0 && (
        <div className="flex flex-wrap gap-px border-b border-observatory-border bg-observatory-border">
          {(Object.entries(EVENT_TYPE_LABELS) as [EventType, string][]).map(([type, label]) => {
            const count = events.filter((e) => e.event_type === type).length
            if (count === 0) return null
            return (
              <div key={type} className="flex items-baseline gap-2 bg-observatory-black px-5 py-3">
                <span className="font-mono text-sm tabular-nums text-text-secondary">{count}</span>
                <span className="text-xs text-text-muted">{label}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Event list */}
      {events.length === 0 ? (
        <div className="px-6 py-20 text-center">
          <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">PROMOTION QUEUE</p>
          <h2 className="mb-3 text-lg font-light text-text-primary">Event Engine Active</h2>
          <p className="mx-auto max-w-md text-sm text-text-muted">
            Events are created automatically when signals exceed promotion thresholds.
            Check back after the next enrichment cycle.
          </p>
        </div>
      ) : (
        <div>
          {events.map((event) => (
            <a
              key={event.id}
              href={`/events/${event.id}`}
              className="group block border-b border-observatory-border px-6 py-5 transition-colors hover:bg-observatory-surface"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="border border-observatory-border px-2 py-0.5 font-mono text-xs text-text-muted">
                    {EVENT_TYPE_LABELS[event.event_type]}
                  </span>
                  <span className="border border-observatory-border px-2 py-0.5 font-mono text-xs text-text-muted">
                    IMPACT {event.impact_score}
                  </span>
                </div>
                <time className="font-mono text-xs text-text-muted" dateTime={event.created_at}>
                  {formatRelativeTime(event.created_at)}
                </time>
              </div>

              <h3 className="mb-1.5 text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                {event.title}
              </h3>
              <p className="text-xs leading-relaxed text-text-muted line-clamp-2">
                {event.summary}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
