import type { Metadata } from 'next'
import Link from 'next/link'
import { SignalCard } from '@/components/signals/signal-card'
import { getSignals, getSignalsCount } from '@/modules/signals/queries'
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
  searchParams: Promise<{ category?: string; page?: string }>
}

/**
 * Signals shown per page. Previously this was a bare `limit: 50` with
 * no pagination of any kind, which meant every signal beyond the 50th
 * was unreachable from the site: production held 121 publicly-visible
 * signals at the time of this fix, so 71 of them (59%) could not be
 * browsed to at all.
 */
const PAGE_SIZE = 50

export default async function SignalsPage({
  searchParams,
}: SignalsPageProps): Promise<React.JSX.Element> {
  const params = await searchParams
  const activeCategory = params.category as SignalCategory | undefined

  const parsedPage = Number.parseInt(params.page ?? '1', 10)
  const currentPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const categoryFilter = activeCategory !== undefined ? { category: activeCategory } : {}

  const [signals, totalCount] = await Promise.all([
    getSignals({
      ...categoryFilter,
      limit: PAGE_SIZE,
      offset: (currentPage - 1) * PAGE_SIZE,
    }),
    getSignalsCount(categoryFilter),
  ])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const categoryQuery = activeCategory ? `category=${activeCategory}&` : ''

  return (
    <div className="mx-auto max-w-7xl">
      <div className="border-b border-observatory-border px-6 py-8">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">SIGNAL DISCOVERY</p>
        <h1 className="text-2xl font-light text-text-primary">Signal Feed</h1>
        <p className="mt-2 text-sm text-text-muted">
          {totalCount} active signal{totalCount !== 1 ? 's' : ''} detected
          {activeCategory ? ` in ${activeCategory.replace('_', ' ')}` : ''}
          {totalPages > 1 ? ` · page ${currentPage} of ${totalPages}` : ''}
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

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          className="flex items-center justify-between border-t border-observatory-border px-6 py-6 font-mono text-xs"
          aria-label="Pagination"
        >
          {currentPage > 1 ? (
            <Link
              href={`/signals?${categoryQuery}page=${currentPage - 1}`}
              className="tracking-wider text-text-muted transition-colors hover:text-text-primary"
            >
              ← PREVIOUS
            </Link>
          ) : (
            <span className="tracking-wider text-observatory-border">← PREVIOUS</span>
          )}

          <span className="tracking-wider text-text-muted">
            {currentPage} / {totalPages}
          </span>

          {currentPage < totalPages ? (
            <Link
              href={`/signals?${categoryQuery}page=${currentPage + 1}`}
              className="tracking-wider text-text-muted transition-colors hover:text-text-primary"
            >
              NEXT →
            </Link>
          ) : (
            <span className="tracking-wider text-observatory-border">NEXT →</span>
          )}
        </nav>
      )}
    </div>
  )
}
