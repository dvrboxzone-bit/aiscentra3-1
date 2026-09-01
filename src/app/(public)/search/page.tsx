import type { Metadata } from 'next'
import Link from 'next/link'
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

/**
 * AIscentra — vfinal /search page (Frontend Design Foundation, layer
 * 5C). Real search() query, dynamic='force-dynamic', generateMetadata
 * (q-dependent title), 2-char minimum-length gate, result grouping
 * (signals/events/reports), real formatRelativeTime/formatCategory,
 * real result hrefs (result.href from search()) -- all unchanged.
 * Visual language migrated to vfinal.
 */
export default async function SearchPage({
  searchParams,
}: SearchPageProps): Promise<React.JSX.Element> {
  const { q = '' } = await searchParams
  const results = q.trim().length >= 2 ? await search(q) : null

  return (
    <>
      <div className="textured-bg relative px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-3xl">
          <div className="mb-12">
            <span className="font-caption mb-4 block text-mint-signal">OBSERVATORY SEARCH</span>
            <h1 className="font-display mb-8 text-[12vw] text-frost md:text-[70px]">
              Search Intelligence.
            </h1>

            <form method="GET" action="/search">
              <div className="flex gap-2">
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search signals, events, reports..."
                  autoFocus
                  className="observatory-input font-body flex-1 border border-border-subtle bg-surface-tonal px-4 py-2.5 text-frost placeholder-silver-haze"
                />
                <button type="submit" className="btn-pill magnetic text-xs">
                  SEARCH
                </button>
              </div>
            </form>
          </div>

          {!results && q.trim().length === 0 && (
            <div className="py-12 text-center">
              <p className="text-silver-haze">
                Search across all Observatory intelligence — signals, events and reports.
              </p>
            </div>
          )}

          {q.trim().length > 0 && q.trim().length < 2 && (
            <p className="text-silver-haze">Enter at least 2 characters to search.</p>
          )}

          {results && results.total === 0 && (
            <div className="py-12 text-center">
              <span className="font-caption mb-2 block text-silver-haze">NO RESULTS</span>
              <p className="text-silver-haze">
                No Observatory intelligence found for &ldquo;{q}&rdquo;.
              </p>
              <p className="mt-3 text-xs text-silver-haze">
                The Observatory is continuously growing. Try a broader term or check back as more
                signals are detected.
              </p>
            </div>
          )}

          {results && results.total > 0 && (
            <div className="space-y-8">
              <p className="font-caption text-silver-haze">
                {results.total} result{results.total !== 1 ? 's' : ''} for &ldquo;{results.query}
                &rdquo;
              </p>

              {results.signals.length > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-3">
                    <span className="font-caption text-silver-haze">SIGNALS</span>
                    <span className="font-caption text-silver-haze">{results.signals.length}</span>
                  </h2>
                  <div className="divide-y divide-border-subtle border border-border-subtle bg-surface-tonal">
                    {results.signals.map((result) => (
                      <Link
                        key={result.id}
                        href={result.href}
                        className="group block px-4 py-4 transition-colors hover:bg-deep-obsidian"
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          {result.score !== undefined && (
                            <span className="font-caption text-silver-haze">{result.score}</span>
                          )}
                          {result.category && (
                            <span className="font-caption text-silver-haze">
                              {formatCategory(result.category)}
                            </span>
                          )}
                          <span className="font-caption text-silver-haze">
                            {formatRelativeTime(result.date)}
                          </span>
                        </div>
                        <p className="font-medium text-frost transition-colors group-hover:text-mint-signal">
                          {result.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-silver-haze">
                          {result.summary}
                        </p>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {results.events.length > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-3">
                    <span className="font-caption text-silver-haze">EVENTS</span>
                    <span className="font-caption text-silver-haze">{results.events.length}</span>
                  </h2>
                  <div className="divide-y divide-border-subtle border border-border-subtle bg-surface-tonal">
                    {results.events.map((result) => (
                      <Link
                        key={result.id}
                        href={result.href}
                        className="group block px-4 py-4 transition-colors hover:bg-deep-obsidian"
                      >
                        <p className="font-caption mb-1 text-silver-haze">
                          {formatRelativeTime(result.date)}
                        </p>
                        <p className="font-medium text-frost transition-colors group-hover:text-mint-signal">
                          {result.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-silver-haze">
                          {result.summary}
                        </p>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {results.reports.length > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-3">
                    <span className="font-caption text-silver-haze">REPORTS</span>
                    <span className="font-caption text-silver-haze">{results.reports.length}</span>
                  </h2>
                  <div className="divide-y divide-border-subtle border border-border-subtle bg-surface-tonal">
                    {results.reports.map((result) => (
                      <Link
                        key={result.id}
                        href={result.href}
                        className="group block px-4 py-4 transition-colors hover:bg-deep-obsidian"
                      >
                        <p className="font-caption mb-1 text-silver-haze">
                          {formatRelativeTime(result.date)}
                        </p>
                        <p className="font-medium text-frost transition-colors group-hover:text-mint-signal">
                          {result.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-silver-haze">
                          {result.summary}
                        </p>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
