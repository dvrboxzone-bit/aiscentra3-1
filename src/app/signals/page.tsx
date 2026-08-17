import type { Metadata } from 'next'
import Link from 'next/link'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
import { VfinalImageSlot } from '@/components/layout/vfinal-image-slot'
import { getSignals } from '@/modules/signals/queries'
import type { Signal, SignalCategory } from '@/types/database'

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

/**
 * AIscentra — vfinal /signals page (Frontend Design Foundation, layer 5A)
 *
 * Visual language migrated to vfinal (VfinalPublicShell, card-sharp
 * grid list matching the homepage's own Featured Signals presentation);
 * all real functional logic UNCHANGED: getSignals() query, category
 * filter (same 9 categories, same /signals?category=X query-param
 * links), empty-state copy, metadata.
 *
 * data-active-signal-count is a REAL, production-critical release-gate
 * contract (staged smoke / TOCTOU / verifyDomain all grep this exact
 * attribute -- see scripts/release/domain-cutover.ts's own
 * checkActiveSignalCountAttribute) -- preserved verbatim on the same
 * root wrapping element, same signals.length value, same rationale
 * (HTML attribute values survive React SSR's hydration-boundary
 * comment insertion, unlike adjacent JSX text children).
 */
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
            {signals.length} active signal{signals.length !== 1 ? 's' : ''} detected
            {activeCategory ? ` in ${activeCategory.replace('_', ' ')}` : ''}
          </p>

          {/* Category filter -- same real routes, same 9 categories, real query params */}
          <div className="mb-12 flex flex-wrap gap-2 border-b border-border-subtle pb-8">
            <Link
              href="/signals"
              className={`btn-pill text-xs ${!activeCategory ? 'bg-frost text-deep-obsidian' : ''}`}
            >
              ALL
            </Link>
            {CATEGORIES.map((cat) => (
              <Link
                key={cat}
                href={`/signals?category=${cat}`}
                className={`btn-pill text-xs ${activeCategory === cat ? 'bg-frost text-deep-obsidian' : ''}`}
              >
                {cat.replace('_', ' ')}
              </Link>
            ))}
          </div>

          {signals.length === 0 ? (
            <div className="border border-border-subtle bg-surface-tonal px-6 py-20 text-center">
              <span className="font-caption mb-2 block text-silver-haze">OBSERVATORY</span>
              <p className="text-silver-haze">
                {activeCategory
                  ? `No signals detected in ${activeCategory.replace('_', ' ')} yet.`
                  : 'Signal Engine initializing. First signals arriving soon.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-px border border-border-subtle bg-deep-obsidian md:grid-cols-3">
              {signals.map((signal) => (
                <VfinalSignalListCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </div>
      </div>
    </VfinalPublicShell>
  )
}

function VfinalSignalListCard({ signal }: { signal: Signal }): React.JSX.Element {
  return (
    <div
      className="card-sharp group p-5"
      data-content-slot="signal"
      data-category={signal.category}
    >
      <VfinalImageSlot className="mb-5 h-40 border-0" />
      <div className="mb-4 flex items-center justify-between">
        <span className="font-caption text-deep-obsidian">{signal.status}</span>
        <span className="text-xs font-medium text-gray-500">
          {signal.category.replace('_', ' ')}
        </span>
      </div>
      <h3 className="mb-3 text-xl font-medium leading-tight">{signal.title}</h3>
      <p className="mb-6 text-sm text-gray-700">{signal.description}</p>
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
