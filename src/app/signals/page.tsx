import type { Metadata } from 'next'
import { SignalCard } from '@/components/signals/signal-card'
import { getSignals } from '@/modules/signals/queries'
import type { SignalCategory } from '@/types/database'

export const metadata: Metadata = {
  title: 'Signals',
  description: 'Live AI ecosystem signal feed. Browse, filter and explore scored intelligence signals.',
}

export const revalidate = 3600

const CATEGORIES: SignalCategory[] = [
  'RESEARCH', 'MODELS', 'COMPANIES', 'INFRASTRUCTURE',
  'OPEN_SOURCE', 'FUNDING', 'REGULATION', 'AGENTS', 'HARDWARE',
]

interface SignalsPageProps {
  searchParams: Promise<{ category?: string }>
}

export default async function SignalsPage({ searchParams }: SignalsPageProps): Promise<React.JSX.Element> {
  const params = await searchParams
  const activeCategory = params.category as SignalCategory | undefined

  const signals = await getSignals({
    ...(activeCategory !== undefined && { category: activeCategory }),
    limit: 50,
  })

  return (
    <div className="mx-auto max-w-7xl">
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
        <a
          href="/signals"
          className={`px-3 py-1 font-mono text-xs tracking-wider transition-colors ${
            !activeCategory
              ? 'bg-observatory-surface text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          ALL
        </a>
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
          signals.map((signal) => (
            <SignalCard key={signal.id} signal={signal} variant="default" />
          ))
        )}
      </div>
    </div>
  )
}
