import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SeverityBadge, CategoryBadge, ConfidenceBadge } from '@/components/ui/badge'
import { ScoreBar } from '@/components/ui/score-bar'
import { SignalIllustration } from '@/components/signals/signal-illustration'
import { getSignalById } from '@/modules/signals/queries'
import { getEventsBySignal } from '@/modules/events/queries'
import { getSourceLinksForSignal } from '@/modules/observations/queries'
import { formatDate, formatRelativeTime, formatCategory } from '@/lib/utils/format'
import { getSignalSeverity } from '@/types/database'

export const dynamic = 'force-dynamic'

interface SignalPageProps {
  params: Promise<{ slug: string }>
}

// Pre-generate paths for known signals at build time
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return []
}

export async function generateMetadata({ params }: SignalPageProps): Promise<Metadata> {
  const { slug } = await params
  const signal = await getSignalById(slug)
  if (!signal) return { title: 'Signal Not Found' }
  return {
    title: signal.title,
    description: signal.description,
  }
}

export default async function SignalPage({ params }: SignalPageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  const [signal, relatedEvents] = await Promise.all([getSignalById(slug), getEventsBySignal(slug)])

  // Fetched only after getSignalById has confirmed the signal is
  // publicly visible (it uses the RLS-bound public client) -- see
  // getSourceLinksForSignal's own docstring for why that ordering is
  // the safety boundary here.
  const sourceLinks = signal ? await getSourceLinksForSignal(signal.observation_ids) : []

  if (!signal) notFound()

  const severity = getSignalSeverity(signal.signal_score)

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 font-mono text-xs text-text-muted" aria-label="Breadcrumb">
        <Link href="/signals" className="hover:text-text-secondary">
          Signals
        </Link>
        <span className="mx-2 text-observatory-border">›</span>
        <span>{formatCategory(signal.category)}</span>
      </nav>

      {/* Illustration */}
      <div className="mb-8 overflow-hidden border border-observatory-border">
        <SignalIllustration
          category={signal.category}
          title={signal.title}
          className="h-auto w-full"
        />
      </div>

      {/* Header */}
      <header className="mb-8 border-b border-observatory-border pb-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={severity} score={signal.signal_score} />
          <CategoryBadge category={signal.category} />
          <ConfidenceBadge score={signal.confidence_score} />
        </div>
        <h1 className="mb-4 text-xl font-medium leading-snug text-text-primary md:text-2xl">
          {signal.title}
        </h1>
        <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-text-muted">
          <time dateTime={signal.created_at}>Detected {formatRelativeTime(signal.created_at)}</time>
          <span className="text-observatory-border">·</span>
          <span>{formatDate(signal.created_at)}</span>
          <span className="text-observatory-border">·</span>
          <span>SIGNAL {signal.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-[1fr_240px]">
        {/* Main content */}
        <div className="space-y-6">
          {/* Analysis */}
          <section>
            <h2 className="mb-3 font-mono text-xs tracking-wider text-text-muted">
              SIGNAL ANALYSIS
            </h2>
            <p className="text-sm leading-relaxed text-text-secondary">{signal.description}</p>
          </section>

          {/* Related events */}
          {relatedEvents.length > 0 && (
            <section className="border-t border-observatory-border pt-6">
              <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">
                RELATED EVENTS ({relatedEvents.length})
              </h2>
              <div className="space-y-3">
                {relatedEvents.map((event) => (
                  <a
                    key={event.id}
                    href={`/events/${event.id}`}
                    className="block border border-observatory-border bg-observatory-surface p-4 transition-colors hover:bg-observatory-dark"
                  >
                    <p className="mb-1 font-mono text-xs text-text-muted">
                      {event.event_type.replace('_', ' ')}
                    </p>
                    <p className="text-sm text-text-secondary">{event.title}</p>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Sources — the URL was always present in the data but was
              never rendered as a link; "SOURCES: N linked" alone gave
              readers no way to verify the claim. */}
          {sourceLinks.length > 0 && (
            <section>
              <h2 className="mb-3 font-mono text-xs tracking-wider text-text-muted">SOURCES</h2>
              <ul className="space-y-2">
                {sourceLinks.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-mono text-xs text-text-secondary underline-offset-4 transition-colors hover:text-text-primary hover:underline"
                    >
                      {source.url}
                    </a>
                    {source.publishedAt && (
                      <span className="ml-2 font-mono text-xs text-text-muted">
                        {formatDate(source.publishedAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Status grid */}
          <section className="border border-observatory-border bg-observatory-surface p-4">
            <h2 className="mb-3 font-mono text-xs tracking-wider text-text-muted">SIGNAL STATUS</h2>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <StatusItem label="Status" value={signal.status} />
              <StatusItem label="Category" value={formatCategory(signal.category)} />
              <StatusItem label="Sources" value={`${signal.observation_ids.length} linked`} />
              <StatusItem label="Entities" value={`${signal.entity_ids.length} detected`} />
              <StatusItem
                label="Override"
                value={signal.manual_override ? 'Manual' : 'Automated'}
              />
              {/* Label is deliberately "Scored" and not "Momentum": this
                  field is momentum_last_calculated (a timestamp), while the
                  sidebar's ScoreBar shows momentum_score (a 0-100 value).
                  Both were previously labelled "Momentum", so the same page
                  rendered "MOMENTUM 20" and "MOMENTUM 3 days ago" for two
                  unrelated values -- the second reading as nonsense. */}
              <StatusItem
                label="Scored"
                value={
                  signal.momentum_last_calculated
                    ? formatRelativeTime(signal.momentum_last_calculated)
                    : 'Pending'
                }
              />
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          <section className="border border-observatory-border bg-observatory-surface p-4">
            <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">SIGNAL SCORES</h2>
            <div className="space-y-2.5">
              <ScoreBar value={signal.signal_score} label="Signal" />
              <ScoreBar value={signal.confidence_score} label="Conf" />
              <ScoreBar value={signal.momentum_score} label="Momentum" />
            </div>
          </section>

          <section className="border border-observatory-border bg-observatory-surface p-4">
            <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">
              FACTOR BREAKDOWN
            </h2>
            <div className="space-y-2">
              <ScoreBar value={signal.impact_factor * 10} label="Impact" />
              <ScoreBar value={signal.actor_factor * 10} label="Actor" />
              <ScoreBar value={signal.novelty_factor * 10} label="Novelty" />
              <ScoreBar value={signal.verifiability_factor * 10} label="Verify" />
              <ScoreBar value={signal.strategic_factor * 10} label="Strategic" />
            </div>
          </section>

          <Link
            href="/signals"
            className="block text-center font-mono text-xs tracking-wider text-text-muted transition-colors hover:text-text-secondary"
          >
            ← ALL SIGNALS
          </Link>
        </aside>
      </div>
    </div>
  )
}

function StatusItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="mb-0.5 font-mono text-xs text-text-muted">{label.toUpperCase()}</p>
      <p className="text-text-secondary">{value}</p>
    </div>
  )
}
