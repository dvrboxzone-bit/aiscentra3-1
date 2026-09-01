import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { SourceFaviconStrip } from '@/components/signals/source-favicon-strip'
import { getSignals, getSignalsCount } from '@/modules/signals/queries'
import { getSourceLinksForSignals } from '@/modules/observations/queries'
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

function isRealCategory(value: string): value is SignalCategory {
  return (REAL_CATEGORIES as readonly string[]).includes(value)
}

// Strict positive integer only: no decimals ("2.5"), no trailing/
// leading garbage ("2abc", "3e2"), no leading zero ("01"), no
// whitespace (" 2 "), no "0" itself, no negative sign. Exactly what a
// canonical, hand-typed page number looks like -- anything else is
// dirty input that must redirect to the canonical URL, never be
// silently parsed/truncated into a different, unstated page.
const STRICT_PAGE_PATTERN = /^[1-9][0-9]*$/

interface SignalsPageProps {
  searchParams: Promise<{ category?: string; page?: string }>
}

/**
 * AIscentra — vfinal /signals catalog page (Frontend Design
 * Foundation, checkpoint 5D, corrected)
 *
 * Real server-side pagination: PAGE_SIZE=25 signals per page, real
 * getSignals({page, pageSize}) using Supabase's own .range() (not a
 * client-side slice of an unbounded fetch, not an infinite-scroll
 * "load more" that keeps appending -- "Show next 25" genuinely
 * navigates to /signals?page=N+1).
 *
 * Sort stability, stated honestly (independent-audit correction, not
 * a typo): getSignals() orders by created_at DESC with a mandatory id
 * ASC tie-breaker -- this guarantees a deterministic, non-duplicating
 * order for a FIXED snapshot of rows. Offset-based (.range())
 * pagination itself cannot guarantee the same guarantee ACROSS
 * separate requests if the underlying data changes between them: a
 * new signal published between a visitor's page-1 and page-2 fetch
 * shifts every subsequent row's offset by one, which can shift a row
 * that was on page 2 onto page 1 (a "skip"), or, less commonly,
 * duplicate a row a visitor already saw. This is a genuine, inherent
 * property of offset pagination against a live, growing table, not a
 * defect specific to this implementation -- it is NOT claimed to be
 * eliminated here, only that ties WITHIN one query's own snapshot are
 * ordered deterministically.
 *
 * category=ALL: canonically redirected to the real, bare /signals URL
 * (a genuine 3xx redirect, not a silently-duplicate URL serving
 * identical content). Any OTHER unknown/invalid category string
 * (neither a real SignalCategory nor "ALL") returns the real Next.js
 * notFound() -- never silently falls back to the ALL catalog, which
 * would mask a broken or typo'd link as if it were valid.
 *
 * Page canonicalization (independent-audit correction): only a strict
 * positive integer >= 2 (matching /^[1-9][0-9]*$/ exactly -- no
 * decimals, no trailing garbage, no leading zero, no whitespace, no
 * negative sign) is accepted as a real page value. Any other page
 * param -- dirty input ("2.5", "2abc", "3e2", "0", "-3", " 2 ", "01")
 * OR the literal, redundant "1" -- triggers a real Next.js redirect()
 * to the canonical URL (page param dropped entirely) BEFORE any
 * signals/count/sources query runs. This replaced an earlier version
 * that silently parseInt()-truncated dirty input (e.g. "2.5" ->
 * page 2, "2abc" -> page 2) into an unstated, different page number
 * instead of canonicalizing the URL itself.
 *
 * Page bounds: a page GENUINELY beyond the real total (page >
 * totalPages, computed from the real getSignalsCount()) returns the
 * real Next.js notFound() -- the previous version's "page 999 of 6"
 * was a real, confirmed defect (a false, self-contradictory state
 * shown to a real visitor).
 *
 * Real per-card source data: ONE batch getSourceLinksForSignals() call
 * for the whole page (REAL BUG FIXED -- was previously up to 25
 * separate admin-client queries, one per signal) -- same real
 * favicon-or-text-fallback SourceLink shape, same real safety
 * filtering, reusing the SAME real, already-tested SourceFaviconStrip
 * component.
 *
 * Real counts: getSignalsCount() applies the exact same real filters
 * (status ACTIVE/PROMOTED, has_verified_source=true, optional
 * category) as getSignals() itself -- REJECTED and unpublished
 * signals are never counted.
 *
 * data-active-signal-count is a REAL, production-critical release-gate
 * contract (staged smoke / TOCTOU / verifyDomain all grep this exact
 * attribute -- see scripts/release/domain-cutover.ts's own
 * checkActiveSignalCountAttribute) -- preserved on the root wrapping
 * element, using signals.length (the real count actually rendered on
 * THIS page).
 */
export default async function SignalsPage({
  searchParams,
}: SignalsPageProps): Promise<React.JSX.Element> {
  const params = await searchParams

  if (params.category === 'ALL') {
    const qs = new URLSearchParams()
    if (params.page !== undefined) qs.set('page', params.page)
    const query = qs.toString()
    redirect(query ? `/signals?${query}` : '/signals')
  }

  if (params.category !== undefined && !isRealCategory(params.category)) {
    notFound()
  }

  const activeCategory = params.category as SignalCategory | undefined

  // Real canonicalization, performed BEFORE any signals/count/sources
  // query: a page param that is either absent (already canonical) or
  // a strict positive integer >= 2 is kept as-is. Anything else --
  // missing strictness ("2.5", "2abc", "3e2", "0", "-3", " 2 ",
  // leading-zero "01") OR the literal, redundant "1" -- redirects to
  // the real canonical URL (no page param at all), never silently
  // reinterpreted into a different, unstated page number.
  const rawPage = params.page
  if (rawPage !== undefined && (rawPage === '1' || !STRICT_PAGE_PATTERN.test(rawPage))) {
    const qs = new URLSearchParams()
    if (activeCategory !== undefined) qs.set('category', activeCategory)
    const query = qs.toString()
    redirect(query ? `/signals?${query}` : '/signals')
  }

  const currentPage = rawPage !== undefined ? Number.parseInt(rawPage, 10) : 1

  const [signals, totalCount] = await Promise.all([
    getSignals({
      ...(activeCategory !== undefined && { category: activeCategory }),
      page: currentPage,
      pageSize: PAGE_SIZE,
    }),
    getSignalsCount(activeCategory !== undefined ? { category: activeCategory } : {}),
  ])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  // A page genuinely beyond the real total is a real 404, not a false
  // "page 999 of 6" state -- checked AFTER the real count is known.
  if (currentPage > totalPages) {
    notFound()
  }

  const sourceLinksBySignal = await getSourceLinksForSignals(
    signals.map((signal) => ({ signalId: signal.id, observationIds: signal.observation_ids })),
  )

  function pageHref(page: number): string {
    const qs = new URLSearchParams()
    if (activeCategory !== undefined) qs.set('category', activeCategory)
    if (page > 1) qs.set('page', String(page))
    const query = qs.toString()
    return query ? `/signals?${query}` : '/signals'
  }

  return (
    <>
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
    </>
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
    <article
      className="flex min-h-72 flex-col border border-border-subtle bg-surface-tonal p-7"
      data-content-slot="signal"
      data-category={signal.category}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="font-caption text-mint-signal">{signal.status}</span>
        <time
          className="font-mono text-[10px] uppercase tracking-widest text-silver-haze"
          dateTime={signal.created_at}
        >
          {formatDate(signal.created_at)}
        </time>
      </div>
      <h3 className="mb-3 text-xl font-medium leading-tight text-frost">{signal.title}</h3>
      <p className="mb-4 text-sm leading-relaxed text-silver-haze">{signal.description}</p>

      {/* Real source: verified favicon (via SourceFaviconStrip) when
          available, else the real source name as plain text -- never
          a fabricated icon. */}
      {sourceLinks.length > 0 ? (
        <div className="mb-4">
          <SourceFaviconStrip sources={sourceLinks} />
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between border-t border-border-subtle pt-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-silver-haze">
          CONFIDENCE {signal.confidence_score}%
        </span>
        <Link
          href={`/signals/${signal.id}`}
          className="magnetic text-sm font-medium text-mint-signal underline"
        >
          Trace <span>↗</span>
        </Link>
      </div>
    </article>
  )
}
