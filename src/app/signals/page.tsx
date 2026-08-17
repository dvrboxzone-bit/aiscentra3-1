import type { Metadata } from 'next'
import Link from 'next/link'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
import { VfinalImageSlot } from '@/components/layout/vfinal-image-slot'
import { SourceFaviconStrip } from '@/components/signals/source-favicon-strip'
import { getSignals, getSignalsCount } from '@/modules/signals/queries'
import { getSourceLinksForSignal } from '@/modules/observations/queries'
import { formatDate } from '@/lib/utils/format'
import type { Signal, SignalCategory } from '@/types/database'
import type { SourceLink } from '@/lib/utils/source-links'

export const metadata: Metadata = {
  title: 'Signals',
  description:
    'Live AI ecosystem signal feed. Browse, filter and explore scored intelligence signals.',
}

export const revalidate = 3600

const PAGE_SIZE = 25

const REAL_CATEGORIES: readonly SignalCategory[] = [
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

function isRealCategory(value: string | undefined): value is SignalCategory {
  return value !== undefined && (REAL_CATEGORIES as readonly string[]).includes(value)
}

interface SignalsPageProps {
  searchParams: Promise<{ category?: string; page?: string }>
}

/**
 * AIscentra — vfinal /signals catalog page (Frontend Design
 * Foundation, checkpoint 5D)
 *
 * Real server-side pagination: PAGE_SIZE=25 signals per page, real
 * getSignals({page, pageSize}) using Supabase's own .range() (not a
 * client-side slice of an unbounded fetch, not an infinite-scroll
 * "load more" that keeps appending -- "Show next 25" genuinely
 * navigates to /signals?page=N+1). Stable sort with a mandatory id
 * tie-breaker (added directly in getSignals()) -- no duplicate or
 * skipped rows across page boundaries even when multiple signals
 * share a created_at timestamp.
 *
 * category=ALL is explicitly rejected: isRealCategory() only accepts
 * one of the 9 real SignalCategory values -- any other string
 * (including the literal "ALL") is treated as "no category filter"
 * (the real ALL catalog), never as a query against a non-existent
 * category value that would silently return zero rows.
 *
 * Real per-card source data: getSourceLinksForSignal(observation_ids)
 * called once per signal (parallelized via Promise.all), reusing the
 * SAME real, already-tested SourceFaviconStrip component (verified
 * favicon OR source-name text fallback -- never a fabricated icon).
 *
 * Real counts: getSignalsCount() applies the exact same real filters
 * (status ACTIVE/PROMOTED, has_verified_source=true, optional
 * category) as getSignals() itself -- REJECTED and unpublished
 * signals are never counted, and the category-page count reflects
 * that category specifically, not a fabricated or telemetry-style
 * number.
 *
 * data-active-signal-count is a REAL, production-critical release-gate
 * contract (staged smoke / TOCTOU / verifyDomain all grep this exact
 * attribute -- see scripts/release/domain-cutover.ts's own
 * checkActiveSignalCountAttribute) -- preserved on the root wrapping
 * element, using signals.length (the real count actually rendered on
 * THIS page), matching the gate's own intent of proving genuinely
 * non-empty rendered content, not merely that the database contains
 * signals somewhere.
 */
export default async function SignalsPage({
  searchParams,
}: SignalsPageProps): Promise<React.JSX.Element> {
  const params = await searchParams
  const activeCategory = isRealCategory(params.category) ? params.category : undefined

  const requestedPage = Number.parseInt(params.page ?? '1', 10)
  const currentPage = Number.isFinite(requestedPage) && requestedPage >= 1 ? requestedPage : 1

  const [signals, totalCount] = await Promise.all([
    getSignals({
      ...(activeCategory !== undefined && { category: activeCategory }),
      page: currentPage,
      pageSize: PAGE_SIZE,
    }),
    getSignalsCount(activeCategory !== undefined ? { category: activeCategory } : {}),
  ])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const sourceLinksBySignal = new Map<string, SourceLink[]>(
    await Promise.all(
      signals.map(
        async (signal): Promise<[string, SourceLink[]]> => [
          signal.id,
          await getSourceLinksForSignal(signal.observation_ids),
        ],
      ),
    ),
  )

  function pageHref(page: number): string {
    const qs = new URLSearchParams()
    if (activeCategory !== undefined) qs.set('category', activeCategory)
    if (page > 1) qs.set('page', String(page))
    const query = qs.toString()
    return query ? `/signals?${query}` : '/signals'
  }

  return (
    <VfinalPublicShell>
      <div
        className="textured-bg relative px-6 pb-24 pt-40"
        data-active-signal-count={signals.length}
      >
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <span className="font-caption mb-4 block text-mint-signal">SIGNAL DISCOVERY</span>
          <h1 className="font-display mb-6 text-[12vw] text-frost md:text-[80px]">Signal Feed.</h1>
          <p className="mb-12 text-lg text-silver-haze">
            {totalCount} published signal{totalCount !== 1 ? 's' : ''}
            {activeCategory ? ` in ${activeCategory.replace('_', ' ')}` : ''} — page {currentPage}{' '}
            of {totalPages}
          </p>

          <div className="mb-12 flex flex-wrap gap-2 border-b border-border-subtle pb-8">
            <Link
              href="/signals"
              className={`btn-pill text-xs ${activeCategory === undefined ? 'bg-frost text-deep-obsidian' : ''}`}
            >
              ALL
            </Link>
            {REAL_CATEGORIES.map((cat) => (
              <Link
                key={cat}
                href={`/signals?category=${cat}`}
                className={`btn-pill text-xs ${activeCategory === cat ? 'bg-frost text-deep-obsidian' : ''}`}
              >
                {cat.replace('_', ' ')}
              </Link>
            ))}
          </div>

          {/* One large primary block with the shared tech-grid,
              hosting all up-to-25 signals of the current page --
              never collapsed to a 6-card featured subset (that's the
              homepage's own, separate section). */}
          <div className="relative border border-border-subtle bg-deep-obsidian p-px">
            <div className="tech-grid" />
            {signals.length === 0 ? (
              <div className="relative z-10 bg-surface-tonal px-6 py-20 text-center">
                <span className="font-caption mb-2 block text-silver-haze">OBSERVATORY</span>
                <p className="text-silver-haze">
                  {activeCategory
                    ? `No signals detected in ${activeCategory.replace('_', ' ')} yet.`
                    : 'Signal Engine initializing. First signals arriving soon.'}
                </p>
              </div>
            ) : (
              <div className="relative z-10 grid gap-px sm:grid-cols-2 lg:grid-cols-3">
                {signals.map((signal) => (
                  <VfinalCatalogCard
                    key={signal.id}
                    signal={signal}
                    sourceLinks={sourceLinksBySignal.get(signal.id) ?? []}
                  />
                ))}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <nav
              className="mt-12 flex flex-wrap items-center justify-center gap-2"
              aria-label="Signal pages"
            >
              {currentPage > 1 && (
                <Link href={pageHref(currentPage - 1)} className="btn-pill text-xs">
                  ← Previous
                </Link>
              )}
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <Link
                  key={page}
                  href={pageHref(page)}
                  aria-current={page === currentPage ? 'page' : undefined}
                  className={`btn-pill text-xs ${page === currentPage ? 'bg-frost text-deep-obsidian' : ''}`}
                >
                  {page}
                </Link>
              ))}
              {currentPage < totalPages && (
                <Link href={pageHref(currentPage + 1)} className="btn-pill text-xs">
                  Show next {PAGE_SIZE} →
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </VfinalPublicShell>
  )
}

function VfinalCatalogCard({
  signal,
  sourceLinks,
}: {
  signal: Signal
  sourceLinks: SourceLink[]
}): React.JSX.Element {
  return (
    <div
      className="card-sharp group p-5"
      data-content-slot="signal"
      data-category={signal.category}
    >
      <VfinalImageSlot className="mb-5 h-40 border-0" />
      <div className="mb-4 flex items-center justify-between">
        <span className="font-caption text-deep-obsidian">{signal.status}</span>
        <time className="text-xs font-medium text-gray-500" dateTime={signal.created_at}>
          {formatDate(signal.created_at)}
        </time>
      </div>
      <h3 className="mb-3 text-xl font-medium leading-tight">{signal.title}</h3>
      <p className="mb-4 text-sm text-gray-700">{signal.description}</p>

      {/* Real source: verified favicon (via SourceFaviconStrip) when
          available, else the real source name as plain text -- never
          a fabricated icon. */}
      {sourceLinks.length > 0 ? (
        <div className="mb-4">
          <SourceFaviconStrip sources={sourceLinks} />
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
          CONFIDENCE {signal.confidence_score}%
        </span>
        <Link
          href={`/signals/${signal.id}`}
          className="magnetic text-sm font-medium text-deep-obsidian underline"
        >
          Trace <span className="text-mint-signal">↗</span>
        </Link>
      </div>
    </div>
  )
}
