import type { Metadata } from 'next'
import { search } from '@/modules/search/queries'
import { formatRelativeTime, formatCategory } from '@/lib/utils/format'


export const dynamic = 'force-dynamic'

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: q ? `Search: ${q}` : 'Search',
    description: 'Search Observatory signals, events and intelligence reports.',
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps): Promise<React.JSX.Element> {
  const { q = '' } = await searchParams
  const results = q.trim().length >= 2 ? await search(q) : null

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">

      {/* Header */}
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">OBSERVATORY SEARCH</p>
        <h1 className="mb-6 text-2xl font-light text-text-primary">Search Intelligence</h1>

        {/* Search form */}
        <form method="GET" action="/search">
          <div className="flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search signals, events, reports..."
              autoFocus
              className="flex-1 border border-observatory-border bg-observatory-surface px-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none focus:border-text-muted transition-colors"
            />
            <button
              type="submit"
              className="border border-observatory-border px-4 py-2.5 font-mono text-xs tracking-wider text-text-muted transition-colors hover:border-text-muted hover:text-text-secondary"
            >
              SEARCH
            </button>
          </div>
        </form>
      </div>

      {/* Results */}
      {!results && q.trim().length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-text-muted">
            Search across all Observatory intelligence — signals, events and reports.
          </p>
        </div>
      )}

      {q.trim().length > 0 && q.trim().length < 2 && (
        <p className="text-sm text-text-muted">Enter at least 2 characters to search.</p>
      )}

      {results && results.total === 0 && (
        <div className="text-center py-12">
          <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">NO RESULTS</p>
          <p className="text-sm text-text-muted">
            No Observatory intelligence found for &ldquo;{q}&rdquo;.
          </p>
          <p className="mt-3 text-xs text-text-muted">
            The Observatory is continuously growing. Try a broader term or check back as more signals are detected.
          </p>
        </div>
      )}

      {results && results.total > 0 && (
        <div className="space-y-8">

          {/* Summary */}
          <p className="font-mono text-xs text-text-muted">
            {results.total} result{results.total !== 1 ? 's' : ''} for &ldquo;{results.query}&rdquo;
          </p>

          {/* Signals */}
          {results.signals.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-3">
                <span className="font-mono text-xs tracking-wider text-text-muted">SIGNALS</span>
                <span className="font-mono text-xs text-text-muted">
                  {results.signals.length}
                </span>
              </h2>
              <div className="divide-y divide-observatory-border border border-observatory-border">
                {results.signals.map((result) => (
                  <a
                    key={result.id}
                    href={result.href}
                    className="group block px-4 py-4 transition-colors hover:bg-observatory-surface"
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      {result.score !== undefined && (
                        <span className="font-mono text-xs text-text-muted">
                          {result.score}
                        </span>
                      )}
                      {result.category && (
                        <span className="font-mono text-xs text-text-muted">
                          {formatCategory(result.category)}
                        </span>
                      )}
                      <span className="font-mono text-xs text-text-muted">
                        {formatRelativeTime(result.date)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                      {result.title}
                    </p>
                    <p className="mt-1 text-xs text-text-muted line-clamp-2">{result.summary}</p>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Events */}
          {results.events.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-3">
                <span className="font-mono text-xs tracking-wider text-text-muted">EVENTS</span>
                <span className="font-mono text-xs text-text-muted">{results.events.length}</span>
              </h2>
              <div className="divide-y divide-observatory-border border border-observatory-border">
                {results.events.map((result) => (
                  <a
                    key={result.id}
                    href={result.href}
                    className="group block px-4 py-4 transition-colors hover:bg-observatory-surface"
                  >
                    <p className="mb-1 font-mono text-xs text-text-muted">
                      {formatRelativeTime(result.date)}
                    </p>
                    <p className="text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                      {result.title}
                    </p>
                    <p className="mt-1 text-xs text-text-muted line-clamp-2">{result.summary}</p>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Reports */}
          {results.reports.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-3">
                <span className="font-mono text-xs tracking-wider text-text-muted">REPORTS</span>
                <span className="font-mono text-xs text-text-muted">{results.reports.length}</span>
              </h2>
              <div className="divide-y divide-observatory-border border border-observatory-border">
                {results.reports.map((result) => (
                  <a
                    key={result.id}
                    href={result.href}
                    className="group block px-4 py-4 transition-colors hover:bg-observatory-surface"
                  >
                    <p className="mb-1 font-mono text-xs text-text-muted">
                      {formatRelativeTime(result.date)}
                    </p>
                    <p className="text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                      {result.title}
                    </p>
                    <p className="mt-1 text-xs text-text-muted line-clamp-2">{result.summary}</p>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
