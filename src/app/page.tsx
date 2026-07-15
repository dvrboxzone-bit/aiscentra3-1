import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SignalCard } from '@/components/signals/signal-card'
import { Pulse } from '@/components/ui/pulse'
import { getMockSignals, getMockSignalStats } from '@/modules/signals/mock'

export const metadata: Metadata = {
  title: 'AIscentra — Intelligence Observatory',
  description: 'Real-time AI ecosystem intelligence. Observe, analyze and understand what matters.',
}

// Revalidate every 4 hours — matches the observation collection schedule
export const revalidate = 14400

// ── Observatory Status Bar ────────────────────────────────────────────────────

function ObservatoryStatus(): React.JSX.Element {
  const stats = getMockSignalStats()

  return (
    <div className="border-b border-observatory-border bg-observatory-dark">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <Pulse size="sm" />
          <span className="font-mono text-xs tracking-wider text-text-muted">
            OBSERVATORY ACTIVE
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Stat label="SIGNALS" value={stats.total} />
          <Stat label="CRITICAL" value={stats.critical} highlight />
          <Stat label="HIGH" value={stats.high} />
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: number
  highlight?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-mono text-sm tabular-nums ${highlight ? 'text-text-primary' : 'text-text-secondary'}`}>
        {value}
      </span>
      <span className="font-mono text-xs text-text-muted">{label}</span>
    </div>
  )
}

// ── Hero Section ──────────────────────────────────────────────────────────────

function ObservatoryHero(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden border-b border-observatory-border">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-7xl px-6 py-16 md:py-24">
        <p className="mb-3 font-mono text-xs tracking-[0.3em] text-text-muted">
          INTELLIGENCE OBSERVATORY
        </p>
        <h1 className="mb-4 text-3xl font-light tracking-tight text-text-primary md:text-5xl">
          What matters in AI
          <br />
          <span className="text-text-muted">right now.</span>
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-text-muted md:text-base">
          AIscentra monitors the global AI ecosystem, detects meaningful signals,
          and transforms fragmented information into structured intelligence.
        </p>
      </div>
    </section>
  )
}

// ── Featured Signals ──────────────────────────────────────────────────────────

function FeaturedSignals(): React.JSX.Element {
  const signals = getMockSignals({ minScore: 75, limit: 3 })

  return (
    <section>
      <SectionHeader
        label="CRITICAL & HIGH"
        title="Featured Signals"
        href="/signals"
        linkLabel="All signals"
      />
      <div className="grid gap-px bg-observatory-border md:grid-cols-3">
        {signals.map((signal) => (
          <SignalCard key={signal.id} signal={signal} variant="featured" className="border-0" />
        ))}
      </div>
    </section>
  )
}

// ── Latest Signals ────────────────────────────────────────────────────────────

function LatestSignals(): React.JSX.Element {
  const signals = getMockSignals({ limit: 6 })

  return (
    <section>
      <SectionHeader
        label="LATEST"
        title="Signal Feed"
        href="/signals"
        linkLabel="View all"
      />
      <div>
        {signals.map((signal) => (
          <SignalCard key={signal.id} signal={signal} variant="default" />
        ))}
      </div>
    </section>
  )
}

// ── Category Activity ─────────────────────────────────────────────────────────

function CategoryActivity(): React.JSX.Element {
  const stats = getMockSignalStats()
  const categories = Object.entries(stats.byCategory).sort(([, a], [, b]) => b - a)

  return (
    <section className="border-l border-observatory-border">
      <div className="px-6 py-4">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">CATEGORY ACTIVITY</p>
        <h2 className="text-base font-medium text-text-primary">Signal Distribution</h2>
      </div>
      <div className="border-t border-observatory-border">
        {categories.map(([category, count]) => (
          <div
            key={category}
            className="flex items-center justify-between border-b border-observatory-border px-6 py-3"
          >
            <span className="font-mono text-xs text-text-muted">
              {category.replace('_', ' ')}
            </span>
            <span className="font-mono text-sm tabular-nums text-text-secondary">{count}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Assistant Entry ───────────────────────────────────────────────────────────

function AssistantEntry(): React.JSX.Element {
  return (
    <section className="border-t border-observatory-border">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="border border-observatory-border bg-observatory-surface p-8 text-center">
          <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">
            OBSERVATORY ASSISTANT
          </p>
          <h2 className="mb-3 text-xl font-light text-text-primary">
            Ask the Observatory
          </h2>
          <p className="mb-6 text-sm text-text-muted">
            Query signals, events and intelligence using natural language.
          </p>
          <a
            href="/assistant"
            className="inline-flex items-center gap-2 border border-observatory-border px-4 py-2 text-xs tracking-wider text-text-secondary transition-colors hover:border-text-muted hover:text-text-primary"
          >
            <Pulse size="sm" />
            OPEN ASSISTANT
          </a>
        </div>
      </div>
    </section>
  )
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  title,
  href,
  linkLabel,
}: {
  label: string
  title: string
  href: string
  linkLabel: string
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between border-b border-observatory-border px-6 py-4">
      <div>
        <p className="mb-0.5 font-mono text-xs tracking-wider text-text-muted">{label}</p>
        <h2 className="text-base font-medium text-text-primary">{title}</h2>
      </div>
      <a
        href={href}
        className="font-mono text-xs tracking-wider text-text-muted transition-colors hover:text-text-secondary"
      >
        {linkLabel.toUpperCase()} →
      </a>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage(): React.JSX.Element {
  return (
    <>
      <ObservatoryStatus />
      <ObservatoryHero />

      <div className="mx-auto max-w-7xl">
        {/* Featured signals — full width */}
        <Suspense fallback={<SectionSkeleton />}>
          <FeaturedSignals />
        </Suspense>

        {/* Two-column: signal feed + category sidebar */}
        <div className="grid md:grid-cols-[1fr_280px]">
          <Suspense fallback={<SectionSkeleton />}>
            <LatestSignals />
          </Suspense>
          <Suspense fallback={<SectionSkeleton />}>
            <CategoryActivity />
          </Suspense>
        </div>
      </div>

      <AssistantEntry />
    </>
  )
}

function SectionSkeleton(): React.JSX.Element {
  return (
    <div className="animate-pulse space-y-px border-b border-observatory-border">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 bg-observatory-surface" />
      ))}
    </div>
  )
}
