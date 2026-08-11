import type { Metadata } from 'next'
import Link from 'next/link'
import { SignalCard } from '@/components/signals/signal-card'
import { getSignals } from '@/modules/signals/queries'
import type { SignalCategory } from '@/types/database'

export const metadata: Metadata = {
  title: 'Signals',
  description:
    'Live AI ecosystem signal feed. Browse, filter and explore scored intelligence signals.',
}

export const revalidate = 3600

const CATEGORIES: SignalCategory[] = [
  'RESEARCH',
  'MODELS',
  'COMPANIES',
  'INFRASTRUCTURE',
  'OPEN_SOURCE',
  'FUNDING',
  'REGULATION',
  'AGENTS',
  'HARDWARE',
]

interface SignalsPageProps {
  searchParams: Promise<{ category?: string }>
}

export default async function SignalsPage({
  searchParams,
}: SignalsPageProps): Promise<React.JSX.Element> {
  const params = await searchParams
  const activeCategory = params.category as SignalCategory | undefined

  const signals = await getSignals({
    ...(activeCategory !== undefined && { category: activeCategory }),
    limit: 50,
  })

  return (
    <div className="mx-auto max-w-7xl" data-active-signal-count={signals.length}>
      {/*
        Real fix (production incident, third architectural review):
        release smoke checks previously grepped the RAW SSR HTML for a
        continuous text substring like "128 active signals detected" --
        but React's server-side rendering inserts HTML comments
        (<!-- -->) between adjacent JSX expression children for
        hydration bookkeeping, so the raw markup for
        `{signals.length} active signal{s} detected` is genuinely
        `128<!-- --> active signal<!-- --><!-- --> detected`, not a
        continuous string -- a real, structural false negative for any
        naive text-substring check, unrelated to whether the feed is
        actually healthy. An HTML *attribute* value, unlike adjacent
        JSX text children, is always a single, uninterrupted string in
        the emitted markup regardless of hydration bookkeeping --
        data-active-signal-count is the stable, machine-readable
        contract release smoke/TOCTOU checks against instead. This is
        the SAME `signals.length` already gated by
        getSignals()'s own has_verified_source filter, so it directly
        reflects the real publication-gate state, not a separate,
        possibly-out-of-sync count.
      */}
      <div className="border-b border-observatory-border px-6 py-8">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">SIGNAL DISCOVERY</p>
        <h1 className="text-2xl font-light text-text-primary">Signal Feed</h1>
        <p className="mt-2 text-sm text-text-muted">
          {signals.length} active signal{signals.length !== 1 ? 's' : ''} detected
          {activeCategory ? ` in ${activeCategory.replace('_', ' ')}` : ''}
        </p>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 border-b border-observatory-border px-6 py-4">
        <Link
          href="/signals"
          className={`px-3 py-1 font-mono text-xs tracking-wider transition-colors ${
            !activeCategory
              ? 'bg-observatory-surface text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          ALL
        </Link>
        {CATEGORIES.map((cat) => (
          <a
            key={cat}
            href={`/signals?category=${cat}`}
            className={`px-3 py-1 font-mono text-xs tracking-wider transition-colors ${
              activeCategory === cat
                ? 'bg-observatory-surface text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {cat.replace('_', ' ')}
          </a>
        ))}
      </div>

      {/* Signal list */}
      <div>
        {signals.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">OBSERVATORY</p>
            <p className="text-sm text-text-muted">
              {activeCategory
                ? `No signals detected in ${activeCategory.replace('_', ' ')} yet.`
                : 'Signal Engine initializing. First signals arriving soon.'}
            </p>
          </div>
        ) : (
          signals.map((signal) => <SignalCard key={signal.id} signal={signal} variant="default" />)
        )}
      </div>
    </div>
  )
}
