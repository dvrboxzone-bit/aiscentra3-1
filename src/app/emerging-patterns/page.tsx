import type { Metadata } from 'next'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

export const metadata: Metadata = {
  title: 'Emerging Patterns',
  description:
    'Emerging Patterns will examine possible connections across scattered signals without confusing repetition with proof.',
}

/**
 * AIscentra — /emerging-patterns page (explicit owner instruction,
 * exact copy supplied by the owner, part of the "Research ▼" menu
 * group). Same real textured-bg + tech-grid pattern already
 * established elsewhere on the site. Honest "in development" status.
 */
export default function EmergingPatternsPage(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[640px]">
          <span className="font-caption mb-4 block text-mint-signal">
            WHEN SCATTERED SIGNALS START TO CONNECT
          </span>
          <h1 className="font-display mb-10 text-[10vw] text-frost md:text-[56px]">
            Emerging Patterns.
          </h1>
          <p className="mb-6 text-lg text-silver-haze">
            Some important shifts first appear as isolated observations — separated by time, source
            and context.
          </p>
          <p className="mb-10 text-lg text-silver-haze">
            Emerging Patterns will examine these possible connections without confusing repetition
            with proof. Each pattern will show its evidence, source relationships, competing
            explanations, open questions, and what could confirm or weaken the hypothesis.
          </p>
          <div className="border border-border-subtle bg-surface-tonal p-6">
            <span className="font-caption block text-silver-haze">
              CONVERGENCE RESEARCH — IN DEVELOPMENT
            </span>
          </div>
        </div>
      </section>
    </VfinalPublicShell>
  )
}
