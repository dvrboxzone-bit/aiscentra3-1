import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getEventById } from '@/modules/events/queries'
import { getSignalById } from '@/modules/signals/queries'
import { formatDate, formatRelativeTime } from '@/lib/utils/format'

export const revalidate = 3600

interface EventPageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return []
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { slug } = await params
  const event = await getEventById(slug)
  if (!event) return { title: 'Event Not Found' }
  return { title: event.title, description: event.summary }
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  LAUNCH:                 'Launch',
  PARTNERSHIP:            'Partnership',
  RESEARCH_BREAKTHROUGH:  'Research Breakthrough',
  FUNDING:                'Funding',
  ACQUISITION:            'Acquisition',
  INFRASTRUCTURE_CHANGE:  'Infrastructure Change',
  REGULATORY_DEVELOPMENT: 'Regulatory Development',
  STRATEGIC_SHIFT:        'Strategic Shift',
}

const FORECAST_OUTCOMES: Record<string, string> = {
  UNRESOLVED:          'Tracking',
  CONFIRMED:           'Confirmed',
  PARTIALLY_CONFIRMED: 'Partially Confirmed',
  CONTRADICTED:        'Contradicted',
}

export default async function EventPage({ params }: EventPageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  const event = await getEventById(slug)
  if (!event) notFound()

  const originSignal = await getSignalById(event.signal_id)

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">

      {/* Breadcrumb */}
      <nav className="mb-6 font-mono text-xs text-text-muted">
        <a href="/events" className="hover:text-text-secondary">Events</a>
        <span className="mx-2 text-observatory-border">›</span>
        <span>{EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}</span>
      </nav>

      {/* Header */}
      <header className="mb-8 border-b border-observatory-border pb-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="border border-observatory-border px-2 py-0.5 font-mono text-xs text-text-secondary">
            {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
          </span>
          <span className="border border-observatory-border px-2 py-0.5 font-mono text-xs text-text-muted">
            IMPACT {event.impact_score}
          </span>
          <span className={`border px-2 py-0.5 font-mono text-xs ${
            event.forecast_outcome === 'CONFIRMED'
              ? 'border-text-secondary/30 text-text-secondary'
              : 'border-observatory-border text-text-muted'
          }`}>
            {FORECAST_OUTCOMES[event.forecast_outcome] ?? event.forecast_outcome}
          </span>
        </div>

        <h1 className="mb-4 text-xl font-medium leading-snug text-text-primary md:text-2xl">
          {event.title}
        </h1>

        <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-text-muted">
          <time dateTime={event.created_at}>
            Published {formatRelativeTime(event.created_at)}
          </time>
          <span className="text-observatory-border">·</span>
          <span>Timeline {formatDate(event.timeline_date)}</span>
          <span className="text-observatory-border">·</span>
          <span>EVENT {event.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-[1fr_220px]">

        {/* Main content */}
        <div className="space-y-6">

          {/* Summary */}
          <section>
            <h2 className="mb-3 font-mono text-xs tracking-wider text-text-muted">SUMMARY</h2>
            <p className="text-sm leading-relaxed text-text-secondary">{event.summary}</p>
          </section>

          {/* Impact */}
          <section className="border border-observatory-border bg-observatory-surface p-5">
            <h2 className="mb-3 font-mono text-xs tracking-wider text-text-muted">IMPACT ANALYSIS</h2>
            <p className="text-sm leading-relaxed text-text-secondary">{event.impact_summary}</p>
          </section>

          {/* Forecast */}
          <section className="border border-observatory-border p-5">
            <h2 className="mb-3 font-mono text-xs tracking-wider text-text-muted">
              FORECAST
              <span className="ml-2 text-observatory-border">·</span>
              <span className="ml-2 text-text-muted">{FORECAST_OUTCOMES[event.forecast_outcome]}</span>
            </h2>
            <p className="text-sm leading-relaxed text-text-muted italic">{event.forecast}</p>
            <p className="mt-3 text-xs text-text-muted opacity-60">
              Forecasts are Observatory assessments, not factual claims.
              Marked UNRESOLVED until subsequent signals confirm or contradict.
            </p>
          </section>

          {/* Origin signal */}
          {originSignal && (
            <section className="border-t border-observatory-border pt-6">
              <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">ORIGIN SIGNAL</h2>
              <a
                href={`/signals/${originSignal.id}`}
                className="block border border-observatory-border bg-observatory-surface p-4 transition-colors hover:bg-observatory-dark"
              >
                <div className="mb-1 flex items-center gap-3">
                  <span className="font-mono text-xs text-text-muted">{originSignal.category}</span>
                  <span className="font-mono text-xs text-text-muted">
                    SCORE {originSignal.signal_score}
                  </span>
                </div>
                <p className="text-sm text-text-secondary">{originSignal.title}</p>
              </a>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-5">
          <section className="border border-observatory-border bg-observatory-surface p-4">
            <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">EVENT METRICS</h2>
            <div className="space-y-3">
              <MetricRow label="Type"     value={EVENT_TYPE_LABELS[event.event_type] ?? event.event_type} />
              <MetricRow label="Impact"   value={`${event.impact_score}/100`} />
              <MetricRow label="Timeline" value={formatDate(event.timeline_date)} />
              <MetricRow label="Entities" value={`${event.affected_entity_ids.length} linked`} />
              <MetricRow label="Override" value={event.manual_override ? 'Manual' : 'Automated'} />
            </div>
          </section>

          <a
            href="/events"
            className="block text-center font-mono text-xs tracking-wider text-text-muted transition-colors hover:text-text-secondary"
          >
            ← ALL EVENTS
          </a>
        </aside>
      </div>
    </div>
  )
}

function MetricRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="mb-0.5 font-mono text-xs text-text-muted">{label.toUpperCase()}</p>
      <p className="text-xs text-text-secondary">{value}</p>
    </div>
  )
}
