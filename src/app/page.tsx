import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SignalCard } from '@/components/signals/signal-card'
import { Pulse } from '@/components/ui/pulse'
import { getSignals, getSignalStats, getFeaturedSignals } from '@/modules/signals/queries'

export const metadata: Metadata = {
  title: 'AIscentra — Intelligence Observatory',
  description: 'Real-time AI ecosystem intelligence. Observe, analyze and understand what matters.',
}

export const revalidate = 3600

// ── Observatory Status ────────────────────────────────────────────────────────

async function ObservatoryStatus(): Promise<React.JSX.Element> {
  const stats = await getSignalStats()

  return (
    <div className="border-b border-observatory-border bg-observatory-dark">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <Pulse size="sm" />
          <span className="font-mono text-xs tracking-wider text-text-muted">OBSERVATORY ACTIVE</span>
        </div>
        <div className="flex items-center gap-6">
          <Stat label="SIGNALS"  value={stats.total} />
          <Stat label="CRITICAL" value={stats.critical} highlight />
          <Stat label="HIGH"     value={stats.high} />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-mono text-sm tabular-nums ${highlight ? 'text-text-primary' : 'text-text-secondary'}`}>
        {value}
      </span>
      <span className="font-mono text-xs text-text-muted">{label}</span>
    </div>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function ObservatoryHero(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden border-b border-observatory-border">
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
        <p className="mb-3 font-mono text-xs tracking-[0.3em] text-text-muted">INTELLIGENCE OBSERVATORY</p>
        <h1 className="mb-4 text-3xl font-light tracking-tight text-text-primary md:text-5xl">
          What matters in AI<br />
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

async function FeaturedSignals(): Promise<React.JSX.Element> {
  const signals = await getFeaturedSignals()

  if (signals.length === 0) {
    return (
      <section>
        <SectionHeader label="CRITICAL & HIGH" title="Featured Signals" href="/signals" linkLabel="All signals" />
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-text-muted">Signal Engine initializing — first signals arriving soon.</p>
        </div>
      </section>
    )
  }

  return (
    <section>
      <SectionHeader label="CRITICAL & HIGH" title="Featured Signals" href="/signals" linkLabel="All signals" />
      <div className="grid gap-px bg-observatory-border md:grid-cols-3">
        {signals.map((signal) => (
          <SignalCard key={signal.id} signal={signal} variant="featured" className="border-0" />
        ))}
      </div>
    </section>
  )
}

// ── Latest Signals ────────────────────────────────────────────────────────────

async function LatestSignals(): Promise<React.JSX.Element> {
  const signals = await getSignals({ limit: 8 })

  return (
    <section>
      <SectionHeader label="LATEST" title="Signal Feed" href="/signals" linkLabel="View all" />
      {signals.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-text-muted">No signals detected yet.</p>
        </div>
      ) : (
        signals.map((signal) => (
          <SignalCard key={signal.id} signal={signal} variant="default" />
        ))
      )}
    </section>
  )
}

// ── Category Sidebar ──────────────────────────────────────────────────────────

async function CategoryActivity(): Promise<React.JSX.Element> {
  const stats = await getSignalStats()
  const categories = Object.entries(stats.byCategory).sort(([, a], [, b]) => b - a)

  return (
    <section className="border-l border-observatory-border">
      <div className="px-6 py-4">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">CATEGORY ACTIVITY</p>
        <h2 className="text-base font-medium text-text-primary">Distribution</h2>
      </div>
      <div className="border-t border-observatory-border">
        {categories.length === 0 ? (
          <div className="px-6 py-4">
            <p className="text-xs text-text-muted">Awaiting signals.</p>
          </div>
        ) : (
          categories.map(([category, count]) => (
            <div key={category} className="flex items-center justify-between border-b border-observatory-border px-6 py-3">
              <a
                href={`/signals?category=${category}`}
                className="font-mono text-xs text-text-muted transition-colors hover:text-text-secondary"
              >
                {category.replace('_', ' ')}
              </a>
              <span className="font-mono text-sm tabular-nums text-text-secondary">{count}</span>
            </div>
          ))
        )}
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
          <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">OBSERVATORY ASSISTANT</p>
          <h2 className="mb-3 text-xl font-light text-text-primary">Ask the Observatory</h2>
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

// ── Shared Section Header ─────────────────────────────────────────────────────

function SectionHeader({ label, title, href, linkLabel }: {
  label: string; title: string; href: string; linkLabel: string
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between border-b border-observatory-border px-6 py-4">
      <div>
        <p className="mb-0.5 font-mono text-xs tracking-wider text-text-muted">{label}</p>
        <h2 className="text-base font-medium text-text-primary">{title}</h2>
      </div>
      <a href={href} className="font-mono text-xs tracking-wider text-text-muted transition-colors hover:text-text-secondary">
        {linkLabel.toUpperCase()} →
      </a>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SectionSkeleton(): React.JSX.Element {
  return (
    <div className="animate-pulse space-y-px">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 bg-observatory-surface" />
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage(): React.JSX.Element {
  return (
    <>
      <Suspense fallback={<div className="h-10 bg-observatory-dark" />}>
        <ObservatoryStatus />
      </Suspense>

      <ObservatoryHero />

      <div className="mx-auto max-w-7xl">
        <Suspense fallback={<SectionSkeleton />}>
          <FeaturedSignals />
        </Suspense>

        <div className="grid md:grid-cols-[1fr_280px]">
          <Suspense fallback={<SectionSkeleton />}>
            <LatestSignals />
          </Suspense>
          <Suspense fallback={<div className="h-64 bg-observatory-surface" />}>
            <CategoryActivity />
          </Suspense>
        </div>
      </div>

      <AssistantEntry />
    </>
  )
}
