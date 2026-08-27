import type { Metadata } from 'next'
import Link from 'next/link'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
import { VfinalHeroDensityScan } from '@/components/layout/vfinal-hero-density-scan'
import { VfinalStrategicMemoryCanvas } from '@/components/layout/vfinal-strategic-memory-canvas'
import { VfinalImageSlot } from '@/components/layout/vfinal-image-slot'
import { VfinalSlider } from '@/components/layout/vfinal-slider'
import {
  assetAt,
  FORECAST_ASSETS,
  getFeaturedSignalAsset,
  HISTORY_ASSETS,
  OBSERVATION_ASSETS,
} from '@/components/layout/vfinal-landing-assets'
import { getFeaturedSignals, getSignals } from '@/modules/signals/queries'
import type { Signal } from '@/types/database'

export const metadata: Metadata = {
  title: 'AIscentra — Intelligence Observatory',
  description:
    'AIscentra is continuous monitoring of the global AI ecosystem. We separate significant changes from noise and preserve the provenance of every statement.',
}

export const revalidate = 3600

// TRAJECTORIES data moved to src/lib/trajectories.ts -- the section
// itself moved from this homepage to its own /trajectories page.

/**
 * AIscentra — vfinal homepage (Frontend Design Foundation, layer 4)
 *
 * Final landing composition: Hero Density Scan -> Featured Signals ->
 * Trajectories -> Forecasts -> Observations -> Strategic Memory ->
 * Assistant -> Signal 001. VfinalPublicShell supplies the shared
 * header/footer/Lenis/progress/back-to-top.
 *
 * Real data, no fabricated numbers (task's own explicit requirement):
 * - Featured Signals: getFeaturedSignals() -- the SAME real production
 *   selection function already used elsewhere in this codebase,
 *   genuinely returns up to 6 real signals (FEATURED_TARGET_COUNT).
 * - Hero Density Scan is a filtration metaphor, not an operational metric. Its
 *   signal count remains explicitly unavailable until a suitable live
 *   source is approved.
 * - Strategic Memory "KNOWLEDGE GRAPH — NODE COUNT UNAVAILABLE": no real
 *   Knowledge Graph node-count query exists in this codebase yet --
 *   shows UNAVAILABLE rather than the HTML's own fabricated "4,716".
 *   Expanded into a bordered status box (independent-review layout
 *   fix, 2026-08-27) matching the same real pattern already used by
 *   the Forecasts section's own "IN DEVELOPMENT" box -- the text
 *   column's real content weight needed to grow to match the
 *   Strategic Memory canvas's own increased height (450px -> 675px,
 *   a separate, earlier explicit owner instruction), not merely
 *   restyled for its own sake.
 * - Observations: 2 real signals, taken from the pool but excluded
 *   from the Featured six, linking to their real /signals/[id] page.
 * - Forecasts: the HTML's own text is ALREADY an honest "IN
 *   DEVELOPMENT" disclosure (not a fabricated forecast) -- kept
 *   verbatim. Its own CTA link (href="#" in the HTML) has no real
 *   /forecasts route to point to -- rendered as inert text instead of
 *   a dead or fabricated link.
 * - History ("Signal 001"): genuine static editorial content (Turing
 *   1950, Dartmouth 1956) -- not fabricated production data, kept
 *   verbatim. Its external reference images are replaced with the
 *   approved local WebP assets from the typed landing asset map.
 *
 * Image slots: every image in the HTML source (Featured Signals x6,
 * Forecasts x2, Observations x2, History x4) is backed by the approved
 * typed local WebP map. No external or temporary image URLs are used.
 */
export default async function HomePage(): Promise<React.JSX.Element> {
  const [featuredSignals, widerPool] = await Promise.all([
    getFeaturedSignals(),
    getSignals({ limit: 12 }),
  ])

  const featuredIds = new Set(featuredSignals.map((s) => s.id))
  const observationCandidates = widerPool.filter((s) => !featuredIds.has(s.id)).slice(0, 2)

  // REAL BUG FIXED (independent review): block/subblock count must
  // stay exactly 6 (Featured Signals) / 2 (Observations) regardless of
  // how many real rows the database actually returns -- a genuinely
  // empty or partial query result must never shrink the section's own
  // geometry. Fixed-length slot arrays pad any missing real signal
  // with `null`, rendered as an honest UNAVAILABLE card at the exact
  // same size/position as a real one (see FeaturedSignalCard/
  // ObservationCard's own null-branch below), rather than fabricating
  // placeholder data or reducing the visible card count.
  const FEATURED_SLOT_COUNT = 6
  const OBSERVATION_SLOT_COUNT = 2
  const featuredSlots: Array<Signal | null> = Array.from(
    { length: FEATURED_SLOT_COUNT },
    (_, i) => featuredSignals[i] ?? null,
  )
  const observationSlots: Array<Signal | null> = Array.from(
    { length: OBSERVATION_SLOT_COUNT },
    (_, i) => observationCandidates[i] ?? null,
  )

  return (
    <VfinalPublicShell>
      {/* ── 01 — Hero ─────────────────────────────────────────────── */}
      <section id="hero" data-section="hero" className="textured-bg relative px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <VfinalHeroDensityScan />
          <h1 className="font-display text-[15vw] text-frost md:text-[120px]">
            Intelligence
            <br />
            Observatory.
          </h1>
          <div className="mt-12 grid gap-12 md:grid-cols-2">
            <div>
              <p className="max-w-[60ch] text-xl font-normal leading-snug text-silver-haze md:text-2xl">
                AIscentra is continuous monitoring of the global AI ecosystem. We separate
                significant changes from noise and preserve the provenance of every statement.
              </p>
            </div>
            <div className="flex items-end justify-start md:justify-end">
              <a href="#signals" className="arrow-link magnetic">
                View signals <span>↓</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      <div className="section-gap" />

      {/* ── 02 — Featured Signals (6 real production signals) ───────── */}
      <section id="signals" data-section="signals" className="textured-bg px-6 py-24">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <span className="font-caption mb-8 block text-silver-haze">01 — Signals</span>
          <h2 className="font-display reveal mb-12 text-[12vw] text-frost md:text-[100px]">
            Scarce signals.
          </h2>
          <div
            className="grid gap-px border border-border-subtle bg-deep-obsidian md:grid-cols-3"
            data-list="signals"
          >
            {featuredSlots.map((signal, i) => (
              <FeaturedSignalCard key={signal?.id ?? `empty-${i}`} signal={signal} index={i + 1} />
            ))}
          </div>
          <div className="mt-12 flex justify-center">
            <Link href="/signals" className="btn-pill magnetic">
              Open signal archive ↗
            </Link>
          </div>
        </div>
      </section>

      <div className="section-gap" />

      {/* ── 02 — Forecasts (honest IN DEVELOPMENT, unchanged from source;
          renumbered from 03 after Trajectories moved to its own
          /trajectories page -- independent-review correction, explicit
          owner instruction) ── */}
      <section
        id="forecasts"
        data-section="forecasts"
        data-status="planned"
        className="textured-bg px-6 py-24"
      >
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <span className="font-caption mb-8 block text-silver-haze">02 — Forecasts</span>
          <h2 className="font-display reveal mb-12 text-[12vw] text-frost md:text-[100px]">
            Forecasts.
          </h2>
          <div className="grid items-center gap-16 md:grid-cols-2">
            <div className="reveal" data-content-slot="forecast-introduction">
              <span className="font-caption mb-4 block text-mint-signal">
                FROM SIGNALS TO FORESIGHT
              </span>
              <p className="mb-6 max-w-[60ch] text-lg text-silver-haze">
                The next shift in AI is rarely revealed by a single event. AIscentra connects
                converging signals, verified evidence and historical patterns to build time-bound,
                testable forecasts of what may happen next.
              </p>
              <p className="mb-8 max-w-[60ch] text-lg text-silver-haze">
                Every forecast will disclose its probability, time horizon, supporting evidence and
                revision history. Outcomes will be measured openly — so predictive accuracy is
                demonstrated, not claimed.
              </p>
              <div
                className="mb-8 border border-border-subtle bg-surface-tonal p-6"
                data-field="development-status"
              >
                <span className="font-caption mb-2 block text-silver-haze">
                  FORECAST ENGINE — IN DEVELOPMENT
                </span>
                <p className="text-sm text-silver-haze">
                  Initial forecasts will appear after the Signal Engine completes production
                  validation.
                </p>
              </div>
              <span
                className="arrow-link opacity-40"
                data-field="forecasts-link"
                title="Not yet available"
              >
                EXPLORE FORECASTS <span>→</span>
              </span>
            </div>
            <div className="reveal grid grid-cols-2 gap-6">
              <VfinalImageSlot
                asset={assetAt(FORECAST_ASSETS, 0)}
                className="group aspect-[3/4] border border-border-subtle"
              />
              <VfinalImageSlot
                asset={assetAt(FORECAST_ASSETS, 1)}
                className="group mt-12 aspect-[3/4] border border-border-subtle"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="section-gap" />

      {/* ── 05 — Observations (2 real signals, excluded from Featured six) ── */}
      <section id="news" data-section="observations" className="textured-bg px-6 py-24">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <span className="font-caption mb-8 block text-silver-haze">03 — Observations</span>
          <div className="mb-12 flex flex-col gap-8 md:flex-row md:items-end">
            <h2 className="font-display reveal flex-1 text-[12vw] text-frost md:text-[100px]">
              Observations.
            </h2>
            <div className="reveal pb-6 md:max-w-md">
              <p className="text-lg leading-snug text-silver-haze">
                Early developments that may become significant signals. AIscentra tracks supporting
                evidence, contradictions and changes over time before reaching a conclusion.
              </p>
            </div>
          </div>

          <div className="grid gap-6">
            {observationSlots.map((signal, i) => (
              <ObservationCard key={signal?.id ?? `empty-${i}`} signal={signal} index={i} />
            ))}
          </div>
        </div>
      </section>

      <div className="section-gap" />

      {/* ── 06 — Strategic Memory ────────────────────────────────────── */}
      <section id="memory" data-section="strategic-memory" className="textured-bg px-6 py-24">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <span className="font-caption mb-8 block text-silver-haze">
                05 — Strategic Memory
              </span>
              <h2 className="font-heading mb-8 text-5xl text-frost md:text-6xl">
                Institutional memory.
              </h2>
              <p className="mb-8 max-w-md text-lg text-silver-haze">
                AIscentra doesn&apos;t just collect signals; it builds a versioned Knowledge Graph.
                Events, entities, and facts are linked over time, creating an evolving memory that
                grows more valuable every year.
              </p>
              <div
                className="mb-8 border border-border-subtle bg-surface-tonal p-6"
                data-field="knowledge-graph-status"
              >
                <div className="mb-2 flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-mint-signal" />
                  <span className="font-caption block text-silver-haze">
                    KNOWLEDGE GRAPH — NODE COUNT UNAVAILABLE
                  </span>
                </div>
                <p className="text-sm text-silver-haze">
                  The animation traces how a Source, Signal, Event, Entity and Fact link together
                  and later get re-verified. Live node and edge counts will appear here once the
                  underlying graph query is connected.
                </p>
              </div>
            </div>
            <VfinalStrategicMemoryCanvas />
          </div>
        </div>
      </section>

      <div className="section-gap" />

      {/* ── 04 — History ("Signal 001" — genuine static editorial content).
          Renumbered from 07 after the Assistant section moved to the
          real sliding side panel (VfinalAssistantPanel, triggered from
          the header's own "Assistant" button on every page) --
          independent-review correction, explicit owner instruction. ── */}
      <section id="signal-001" data-section="history" className="textured-bg px-6 py-24">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <span className="font-caption mb-8 block text-silver-haze">04 — Signal 001</span>
          <h2 className="font-display reveal mb-12 text-[12vw] text-frost md:text-[100px]">
            The Convergence.
          </h2>
          <p className="reveal mb-12 max-w-2xl text-xl text-silver-haze">
            1943 → 1956. The beginning of AI was not an invention. It was a convergence of
            independent ideas, researchers, and approaches, gradually moving toward the same
            question: Could intelligence itself become a computational object?
          </p>
          <div className="grid gap-6">
            <div className="reveal group border border-border-subtle bg-surface-tonal md:flex">
              <VfinalSlider
                assets={[assetAt(HISTORY_ASSETS, 0), assetAt(HISTORY_ASSETS, 1)]}
                className="aspect-video border-0 md:aspect-auto md:w-2/5"
              />
              <div className="flex flex-col justify-center p-8 md:w-3/5 md:p-12">
                <div className="mb-4 flex items-center gap-4">
                  <span className="font-caption text-silver-haze">FACT</span>
                  <span className="font-caption text-mint-signal">VERIFIED</span>
                </div>
                <h3 className="font-heading mb-4 text-3xl text-frost md:text-4xl">
                  Can machines think?
                </h3>
                <p className="mb-6 max-w-[60ch] text-silver-haze">
                  In 1950, British mathematician Alan Turing published &quot;Computing Machinery and
                  Intelligence&quot;. He introduced the imitation game — a thought experiment later
                  known as the Turing Test. He moved the discussion from abstract philosophy toward
                  questions that could be investigated through computation and behavior.
                </p>
              </div>
            </div>
            <div className="reveal group border border-border-subtle bg-surface-tonal md:flex">
              <VfinalSlider
                assets={[assetAt(HISTORY_ASSETS, 2), assetAt(HISTORY_ASSETS, 3)]}
                className="aspect-video border-0 md:aspect-auto md:w-2/5"
              />
              <div className="flex flex-col justify-center p-8 md:w-3/5 md:p-12">
                <div className="mb-4 flex items-center gap-4">
                  <span className="font-caption text-silver-haze">EVENT</span>
                  <span className="font-caption text-mint-signal">CONVERGENCE</span>
                </div>
                <h3 className="font-heading mb-4 text-3xl text-frost md:text-4xl">
                  Dartmouth, Summer 1956
                </h3>
                <p className="mb-6 max-w-[60ch] text-silver-haze">
                  In the summer of 1956, researchers gathered at Dartmouth College. Dartmouth did
                  not create every idea that would become AI. What it did was arguably more
                  important: It brought several emerging research directions together under a common
                  intellectual framework.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </VfinalPublicShell>
  )
}

function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.round(diffHr / 24)}d ago`
}

/**
 * The HTML source's own "claim-type" badge (FACT/INFERENCE/HYPOTHESIS/
 * FORECAST) has no corresponding real field on Signal -- fabricating
 * this classification would misrepresent real data. Signal.status
 * (ACTIVE/PROMOTED/WEAK/...) is the closest genuinely real
 * classification available, shown in the exact same visual slot.
 */
function FeaturedSignalCard({
  signal,
  index,
}: {
  signal: Signal | null
  index: number
}): React.JSX.Element {
  const slotIndex = String(index).padStart(2, '0')

  // REAL BUG FIXED (independent review): a missing real signal for
  // this slot must render an honest UNAVAILABLE card at the exact
  // same size/DOM position -- never fewer than 6 cards, never a
  // fabricated title/description/confidence to fill the gap.
  if (!signal) {
    return (
      <div
        className="card-sharp reveal group p-5"
        data-content-slot="signal"
        data-slot-index={slotIndex}
      >
        <VfinalImageSlot
          asset={getFeaturedSignalAsset(undefined, index)}
          className="mb-5 h-40 border-0"
        />
        <div className="mb-4 flex items-center justify-between">
          <span className="font-caption text-deep-obsidian opacity-40">UNAVAILABLE</span>
        </div>
        <h3 className="mb-3 text-xl font-medium leading-tight text-gray-400">UNAVAILABLE</h3>
        <p className="mb-6 text-sm text-gray-500">
          No real signal is currently available for this slot.
        </p>
        <div className="flex items-center justify-between border-t border-gray-200 pt-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400">
            CONFIDENCE UNAVAILABLE
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="card-sharp reveal group p-5"
      data-content-slot="signal"
      data-slot-index={slotIndex}
      data-category={signal.category}
    >
      <VfinalImageSlot
        asset={getFeaturedSignalAsset(signal.category, index)}
        className="mb-5 h-40 border-0"
      />
      <div className="mb-4 flex items-center justify-between">
        <span className="font-caption text-deep-obsidian">{signal.status}</span>
        <span className="text-xs font-medium text-gray-500">{relativeTime(signal.created_at)}</span>
      </div>
      <h3 className="mb-3 text-xl font-medium leading-tight text-deep-obsidian">{signal.title}</h3>
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

function ObservationCard({
  signal,
  index,
}: {
  signal: Signal | null
  index: number
}): React.JSX.Element {
  if (!signal) {
    return (
      <div
        className="reveal group border border-border-subtle bg-surface-tonal md:flex"
        data-content-slot="observation"
      >
        <VfinalImageSlot
          asset={assetAt(OBSERVATION_ASSETS, index)}
          className="aspect-video border-0 md:aspect-auto md:w-2/5"
        />
        <div className="flex flex-col justify-center p-8 md:w-3/5 md:p-12">
          <div className="mb-4 flex items-center gap-4">
            <span className="font-caption text-silver-haze opacity-40">UNAVAILABLE</span>
          </div>
          <h3 className="font-heading mb-4 text-3xl text-silver-haze opacity-40 md:text-4xl">
            UNAVAILABLE
          </h3>
          <p className="mb-6 max-w-[60ch] text-silver-haze opacity-60">
            No real observation is currently available for this slot.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="reveal group border border-border-subtle bg-surface-tonal md:flex"
      data-content-slot="observation"
    >
      <VfinalImageSlot
        asset={assetAt(OBSERVATION_ASSETS, index)}
        className="aspect-video border-0 md:aspect-auto md:w-2/5"
      />
      <div className="flex flex-col justify-center p-8 md:w-3/5 md:p-12">
        <div className="mb-4 flex items-center gap-4">
          <span className="font-caption text-silver-haze">{signal.category}</span>
          <span className="font-caption text-mint-signal">{signal.status}</span>
        </div>
        <h3 className="font-heading mb-4 text-3xl text-frost md:text-4xl">{signal.title}</h3>
        <p className="mb-6 max-w-[60ch] text-silver-haze">{signal.description}</p>
        <Link href={`/signals/${signal.id}`} className="arrow-link magnetic self-start">
          Evidence <span>↗</span>
        </Link>
      </div>
    </div>
  )
}
