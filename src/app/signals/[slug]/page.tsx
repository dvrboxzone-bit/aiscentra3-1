import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SeverityBadge, CategoryBadge, ConfidenceBadge } from '@/components/ui/badge'
import { ScoreBar } from '@/components/ui/score-bar'
import { getMockSignals, getMockSignalBySlug } from '@/modules/signals/mock'
import { formatDate, formatRelativeTime, formatCategory } from '@/lib/utils/format'
import { getSignalSeverity } from '@/types/database'

export const revalidate = 3600

interface SignalPageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return getMockSignals().map((s) => ({ slug: s.id }))
}

export async function generateMetadata({ params }: SignalPageProps): Promise<Metadata> {
  const { slug } = await params
  const signal = getMockSignalBySlug(slug)
  if (!signal) return { title: 'Signal Not Found' }

  return {
    title: signal.title,
    description: signal.description,
  }
}

export default async function SignalPage({ params }: SignalPageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  const signal = getMockSignalBySlug(slug)

  if (!signal) notFound()

  const severity = getSignalSeverity(signal.signal_score)

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">

      {/* Breadcrumb */}
      <nav className="mb-6 font-mono text-xs text-text-muted" aria-label="Breadcrumb">
        <a href="/signals" className="hover:text-text-secondary">Signals</a>
        <span className="mx-2 text-observatory-border">›</span>
        <span>{formatCategory(signal.category)}</span>
      </nav>

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

        <div className="flex items-center gap-4 font-mono text-xs text-text-muted">
          <time dateTime={signal.created_at}>
            Detected {formatRelativeTime(signal.created_at)}
          </time>
          <span className="text-observatory-border">·</span>
          <span>{formatDate(signal.created_at)}</span>
          <span className="text-observatory-border">·</span>
          <span>SIGNAL {signal.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </header>

      {/* Two-column layout */}
      <div className="grid gap-8 md:grid-cols-[1fr_240px]">

        {/* Main content */}
        <div className="space-y-6">
          {/* Description */}
          <section>
            <h2 className="mb-3 font-mono text-xs tracking-wider text-text-muted">SIGNAL ANALYSIS</h2>
            <p className="text-sm leading-relaxed text-text-secondary">{signal.description}</p>
          </section>

          {/* Status */}
          <section className="border border-observatory-border bg-observatory-surface p-4">
            <h2 className="mb-3 font-mono text-xs tracking-wider text-text-muted">SIGNAL STATUS</h2>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <StatusItem label="Status"    value={signal.status} />
              <StatusItem label="Category"  value={formatCategory(signal.category)} />
              <StatusItem label="Sources"   value={`${signal.observation_ids.length} linked`} />
              <StatusItem label="Entities"  value={`${signal.entity_ids.length} detected`} />
              <StatusItem label="Override"  value={signal.manual_override ? 'Manual' : 'Automated'} />
              <StatusItem
                label="Momentum"
                value={signal.momentum_last_calculated
                  ? formatRelativeTime(signal.momentum_last_calculated)
                  : 'Pending'}
              />
            </div>
          </section>
        </div>

        {/* Sidebar — scoring */}
        <aside className="space-y-6">
          <section className="border border-observatory-border bg-observatory-surface p-4">
            <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">SIGNAL SCORES</h2>
            <div className="space-y-2.5">
              <ScoreBar value={signal.signal_score}     label="Signal" />
              <ScoreBar value={signal.confidence_score} label="Conf" />
              <ScoreBar value={signal.momentum_score}   label="Momentum" />
            </div>
          </section>

          <section className="border border-observatory-border bg-observatory-surface p-4">
            <h2 className="mb-4 font-mono text-xs tracking-wider text-text-muted">FACTOR BREAKDOWN</h2>
            <div className="space-y-2">
              <ScoreBar value={signal.impact_factor * 10}       label="Impact" />
              <ScoreBar value={signal.actor_factor * 10}        label="Actor" />
              <ScoreBar value={signal.novelty_factor * 10}      label="Novelty" />
              <ScoreBar value={signal.verifiability_factor * 10} label="Verify" />
              <ScoreBar value={signal.strategic_factor * 10}    label="Strategic" />
            </div>
          </section>

          <a
            href="/signals"
            className="block text-center font-mono text-xs tracking-wider text-text-muted transition-colors hover:text-text-secondary"
          >
            ← ALL SIGNALS
          </a>
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
