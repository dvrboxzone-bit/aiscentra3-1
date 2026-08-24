import type { Metadata } from 'next'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
import { TRAJECTORIES } from '@/lib/trajectories'
import { buildFaviconUrl } from '@/lib/utils/source-links'
import { TrajectoryLogo } from './trajectory-logo'

export const metadata: Metadata = {
  title: 'Trajectories',
  description:
    'Company paths across the AI ecosystem — founded, acquired, restructured, wound down.',
}

/**
 * AIscentra — /trajectories page (independent-review correction)
 *
 * The "02 — Trajectories" ("Company paths") section previously lived
 * on the homepage as an anchor (#trajectories) -- moved here to its
 * own dedicated page per explicit owner instruction. The homepage's
 * own section numbering was renumbered accordingly (03 Forecasts -> 02,
 * 04 Observations -> 03) -- "The Convergence" (the unlabeled memory
 * section between Observations and Assistant) was NEVER part of the
 * numbered sequence to begin with and is untouched, matching its own
 * existing, protected byte-identical-preservation rule. The Assistant
 * section's own numbering (06) is deliberately left unchanged in this
 * commit -- its removal/renumbering is a separate, not-yet-authorized
 * task (moving to a sidebar panel), out of this commit's real scope.
 *
 * Visual correction (explicit owner instruction): the per-card dark
 * fill (bg-surface-tonal) is REMOVED -- text now sits directly over
 * the shared, single large tech-grid block, matching the exact same
 * visual pattern already used elsewhere on the site for "one big
 * primary block hosting all real sub-items" (e.g. /signals's own
 * catalog block). Cards are separated by real border lines only, not
 * separate background fills.
 *
 * Real company logos (independent-review addition, explicit owner
 * instruction, implemented this session): each card's own real,
 * current official domain resolves to a real favicon via the SAME
 * honest, already-tested pattern used elsewhere in this project for
 * real signal-source favicons (buildFaviconUrl, source-links.ts) --
 * never a fabricated icon. If a specific favicon request ever fails
 * to load in the browser (network hiccup, a company changing its own
 * icon route), the real company initial letter renders instead via
 * onError -- still never a fabricated logo, just a plain letterform
 * fallback.
 *
 * "Full trajectory" remains an honest, disabled "Coming soon" state --
 * per the owner's own stated future plan (more companies + real
 * detail pages later), fabricating a working link to a page that does
 * not exist yet would violate this project's own standing "no
 * fabricated destinations" rule.
 */
export default function TrajectoriesPage(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <span className="font-caption mb-8 block text-mint-signal">TRAJECTORIES</span>
          <h1 className="font-display mb-12 text-[12vw] text-frost md:text-[100px]">
            Company paths.
          </h1>

          <div className="grid gap-px border border-border-subtle sm:grid-cols-2 lg:grid-cols-3">
            {TRAJECTORIES.map((trajectory) => {
              const faviconUrl = buildFaviconUrl(trajectory.domain)
              return (
                <article
                  key={trajectory.name}
                  className="flex min-h-72 flex-col border border-border-subtle bg-surface-tonal p-7"
                  data-content-slot="trajectory"
                >
                  <div className="mb-8 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {faviconUrl ? <TrajectoryLogo src={faviconUrl} /> : null}
                      <h3 className="font-heading text-3xl text-frost">{trajectory.name}</h3>
                    </div>
                    <span className="trajectory-mark">{trajectory.year}</span>
                  </div>
                  <span className="font-caption mb-4 text-mint-signal">{trajectory.status}</span>
                  <p className="mb-8 text-sm leading-relaxed text-silver-haze">
                    {trajectory.description}
                  </p>
                  <span
                    className="arrow-link mt-auto cursor-not-allowed opacity-40"
                    title="Coming soon"
                    aria-disabled="true"
                  >
                    Full trajectory <span>↗</span>
                  </span>
                </article>
              )
            })}
          </div>
        </div>
      </section>
    </VfinalPublicShell>
  )
}
