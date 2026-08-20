import type { Metadata } from 'next'
import Link from 'next/link'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
import { getEvents } from '@/modules/events/queries'
import { formatRelativeTime } from '@/lib/utils/format'
import type { EventType } from '@/types/database'

export const metadata: Metadata = {
  title: 'Events',
  description:
    'AI ecosystem events — significant developments promoted from the Observatory signal feed.',
}

export const revalidate = 3600

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  LAUNCH: 'Launch',
  PARTNERSHIP: 'Partnership',
  RESEARCH_BREAKTHROUGH: 'Research',
  FUNDING: 'Funding',
  ACQUISITION: 'Acquisition',
  INFRASTRUCTURE_CHANGE: 'Infrastructure',
  REGULATORY_DEVELOPMENT: 'Regulation',
  STRATEGIC_SHIFT: 'Strategic Shift',
}

/**
 * AIscentra — vfinal /events page (Frontend Design Foundation, layer 5B)
 *
 * Real getEvents() query, threshold-explanation copy, event-type
 * label map, per-type counts, empty-state copy -- all unchanged.
 * Visual language migrated to vfinal.
 */
export default async function EventsPage(): Promise<React.JSX.Element> {
  const events = await getEvents({ limit: 30 })

  return (
    <VfinalPublicShell>
      <div className="textured-bg relative px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <span className="font-caption mb-4 block text-mint-signal">EVENT MONITORING</span>
          <h1 className="font-display mb-6 text-[12vw] text-frost md:text-[80px]">Events.</h1>
          <p className="mb-12 text-lg text-silver-haze">
            {events.length > 0
              ? `${events.length} ecosystem event${events.length !== 1 ? 's' : ''} detected`
              : 'Events appear when signals cross promotion thresholds (score ≥ 70, confidence ≥ 65)'}
          </p>

          {events.length > 0 && (
            <div className="mb-12 flex flex-wrap gap-px border border-border-subtle bg-deep-obsidian">
              {(Object.entries(EVENT_TYPE_LABELS) as [EventType, string][]).map(([type, label]) => {
                const count = events.filter((e) => e.event_type === type).length
                if (count === 0) return null
                return (
                  <div key={type} className="flex items-baseline gap-2 bg-surface-tonal px-5 py-3">
                    <span className="font-mono text-sm tabular-nums text-frost">{count}</span>
                    <span className="text-xs text-silver-haze">{label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {events.length === 0 ? (
            <div className="border border-border-subtle bg-surface-tonal px-6 py-20 text-center">
              <span className="font-caption mb-2 block text-silver-haze">PROMOTION QUEUE</span>
              <h2 className="font-heading mb-3 text-2xl text-frost">Event Engine Active</h2>
              <p className="mx-auto max-w-md text-silver-haze">
                Events are created automatically when signals exceed promotion thresholds. Check
                back after the next enrichment cycle.
              </p>
            </div>
          ) : (
            <div className="grid gap-px border border-border-subtle bg-deep-obsidian">
              {events.map((event) => (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="group block bg-surface-tonal px-6 py-5 transition-colors hover:bg-deep-obsidian"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="pill border border-border-subtle px-2 py-0.5 text-xs text-silver-haze">
                        {EVENT_TYPE_LABELS[event.event_type]}
                      </span>
                      <span className="pill border border-border-subtle px-2 py-0.5 text-xs text-silver-haze">
                        IMPACT {event.impact_score}
                      </span>
                    </div>
                    <time className="font-caption text-silver-haze" dateTime={event.created_at}>
                      {formatRelativeTime(event.created_at)}
                    </time>
                  </div>
                  <h3 className="mb-1.5 text-lg font-medium text-frost transition-colors group-hover:text-mint-signal">
                    {event.title}
                  </h3>
                  <p className="line-clamp-2 text-sm leading-relaxed text-silver-haze">
                    {event.summary}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </VfinalPublicShell>
  )
}
