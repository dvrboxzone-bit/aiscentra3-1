import type { Metadata } from 'next'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

export const metadata: Metadata = {
  title: 'Editorial',
  description:
    'AIscentra Editorial will turn verified AI signals into clear, accountable analysis.',
}

/**
 * AIscentra — /editorial page (explicit owner instruction, exact
 * copy supplied by the owner, part of the "Research ▼" menu group
 * introduced alongside this page). Same real textured-bg + tech-grid
 * pattern already established by /subscribe, /trajectories -- no new
 * visual language introduced. Honest "in development" status, same
 * pattern already used by the homepage's own Forecasts section.
 */
export default function EditorialPage(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[640px]">
          <span className="font-caption mb-4 block text-mint-signal">
            EVIDENCE BEFORE CONCLUSIONS
          </span>
          <h1 className="font-display mb-10 text-[10vw] text-frost md:text-[56px]">
            AIscentra Editorial.
          </h1>
          <p className="mb-10 text-lg text-silver-haze">
            AIscentra Editorial will turn verified AI signals into clear, accountable analysis.
            Every published brief will trace its claims to evidence, distinguish facts from
            inference, show what remains unknown, and preserve a visible revision history.
          </p>
          <div className="border border-border-subtle bg-surface-tonal p-6">
            <span className="font-caption block text-silver-haze">
              EDITORIAL LAYER — IN DEVELOPMENT
            </span>
          </div>
        </div>
      </section>
    </VfinalPublicShell>
  )
}
