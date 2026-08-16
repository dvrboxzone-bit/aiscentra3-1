import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
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
  LAUNCH: 'Launch',
  PARTNERSHIP: 'Partnership',
  RESEARCH_BREAKTHROUGH: 'Research Breakthrough',
  FUNDING: 'Funding',
  ACQUISITION: 'Acquisition',
  INFRASTRUCTURE_CHANGE: 'Infrastructure Change',
  REGULATORY_DEVELOPMENT: 'Regulatory Development',
  STRATEGIC_SHIFT: 'Strategic Shift',
}

const FORECAST_OUTCOMES: Record<string, string> = {
  UNRESOLVED: 'Tracking',
  CONFIRMED: 'Confirmed',
  PARTIALLY_CONFIRMED: 'Partially Confirmed',
  CONTRADICTED: 'Contradicted',
}

/**
 * AIscentra — vfinal /events/[slug] page (Frontend Design Foundation,
 * layer 5B). Real getEventById, getSignalById (origin signal),
 * generateMetadata, generateStaticParams, notFound() -- all unchanged.
 * Visual language migrated to vfinal.
 */
export default async function EventPage({ params }: EventPageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  const event = await getEventById(slug)
  if (!event) notFound()

  const originSignal = await getSignalById(event.signal_id)

  return (
    <VfinalPublicShell>
      <div className="textured-bg relative px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-4xl">
          <nav className="font-caption mb-6 text-silver-haze">
            <Link href="/events" className="hover:text-mint-signal">
              Events
            </Link>
            <span className="mx-2">›</span>
            <span>{EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}</span>
          </nav>

          <header className="mb-8 border-b border-border-subtle pb-8">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="pill border border-border-subtle px-2 py-0.5 text-xs text-silver-haze">
                {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
              </span>
              <span className="pill border border-border-subtle px-2 py-0.5 text-xs text-silver-haze">
                IMPACT {event.impact_score}
              </span>
              <span
                className={`pill border px-2 py-0.5 text-xs ${
                  event.forecast_outcome === 'CONFIRMED'
                    ? 'border-mint-signal text-mint-signal'
                    : 'border-border-subtle text-silver-haze'
                }`}
              >
                {FORECAST_OUTCOMES[event.forecast_outcome] ?? event.forecast_outcome}
              </span>
            </div>

            <h1 className="font-heading mb-4 text-3xl text-frost md:text-4xl">{event.title}</h1>

            <div className="font-caption flex flex-wrap items-center gap-4 text-silver-haze">
              <time dateTime={event.created_at}>
                Published {formatRelativeTime(event.created_at)}
              </time>
              <span>·</span>
              <span>Timeline {formatDate(event.timeline_date)}</span>
              <span>·</span>
              <span>EVENT {event.id.slice(0, 8).toUpperCase()}</span>
            </div>
          </header>

          <div className="grid gap-8 md:grid-cols-[1fr_220px]">
            <div className="space-y-6">
              <section>
                <h2 className="font-caption mb-3 text-silver-haze">SUMMARY</h2>
                <p className="text-lg leading-relaxed text-silver-haze">{event.summary}</p>
              </section>

              <section className="border border-border-subtle bg-surface-tonal p-5">
                <h2 className="font-caption mb-3 text-silver-haze">IMPACT ANALYSIS</h2>
                <p className="leading-relaxed text-silver-haze">{event.impact_summary}</p>
              </section>

              <section className="border border-border-subtle p-5">
                <h2 className="font-caption mb-3 text-silver-haze">
                  FORECAST <span className="mx-2">·</span>
                  <span>{FORECAST_OUTCOMES[event.forecast_outcome]}</span>
                </h2>
                <p className="italic leading-relaxed text-silver-haze">{event.forecast}</p>
                <p className="mt-3 text-xs text-silver-haze opacity-60">
                  Forecasts are Observatory assessments, not factual claims. Marked UNRESOLVED until
                  subsequent signals confirm or contradict.
                </p>
              </section>

              {originSignal && (
                <section className="border-t border-border-subtle pt-6">
                  <h2 className="font-caption mb-4 text-silver-haze">ORIGIN SIGNAL</h2>
                  <Link
                    href={`/signals/${originSignal.id}`}
                    className="block border border-border-subtle bg-surface-tonal p-4 transition-colors hover:border-mint-signal"
                  >
                    <div className="mb-1 flex items-center gap-3">
                      <span className="font-caption text-silver-haze">{originSignal.category}</span>
                      <span className="font-caption text-silver-haze">
                        SCORE {originSignal.signal_score}
                      </span>
                    </div>
                    <p className="text-frost">{originSignal.title}</p>
                  </Link>
                </section>
              )}
            </div>

            <aside className="space-y-5">
              <section className="border border-border-subtle bg-surface-tonal p-4">
                <h2 className="font-caption mb-4 text-silver-haze">EVENT METRICS</h2>
                <div className="space-y-3">
                  <MetricRow
                    label="Type"
                    value={EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                  />
                  <MetricRow label="Impact" value={`${event.impact_score}/100`} />
                  <MetricRow label="Timeline" value={formatDate(event.timeline_date)} />
                  <MetricRow
                    label="Entities"
                    value={`${event.affected_entity_ids.length} linked`}
                  />
                  <MetricRow
                    label="Override"
                    value={event.manual_override ? 'Manual' : 'Automated'}
                  />
                </div>
              </section>

              <Link
                href="/events"
                className="font-caption block text-center text-silver-haze transition-colors hover:text-mint-signal"
              >
                ← ALL EVENTS
              </Link>
            </aside>
          </div>
        </div>
      </div>
    </VfinalPublicShell>
  )
}

function MetricRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="font-caption mb-0.5 text-silver-haze">{label.toUpperCase()}</p>
      <p className="text-xs text-frost">{value}</p>
    </div>
  )
}
