import type { Metadata } from 'next'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'How a raw observation becomes a published Signal: the filters it must pass, the evidence it must carry, and the exact point where AIscentra rejects more candidates than it publishes.',
}

/**
 * AIscentra — /methodology page. Real, standalone legal/transparency
 * page (not a fabricated destination) -- text content specified
 * verbatim by the owner. Minimal individual-project legal contour, no
 * company/VAT claims per the owner's own explicit scope.
 */
export default function MethodologyPage(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[760px]">
          <span className="font-caption mb-4 block text-mint-signal">FRAMEWORK</span>
          <h1 className="font-display mb-12 text-[10vw] text-frost md:text-[56px]">Methodology.</h1>
          <div className="space-y-6 text-lg leading-relaxed text-silver-haze">
            <p>
              AIscentra monitors publicly available information about artificial intelligence,
              including official announcements, technical documentation, research publications,
              reputable reporting, and open-source project updates.
            </p>
            <p>
              Signals are selected for relevance, novelty, potential impact, and source reliability.
              Each published signal includes source links and publication context where available.
            </p>
            <p>
              AI-assisted processing may be used for classification, summarization, and analysis.
              Published material may be corrected, updated, or removed when new evidence emerges.
            </p>
            <p>
              Forecasts and trajectories represent analytical scenarios, not statements of fact or
              guarantees of future outcomes.
            </p>
          </div>
        </div>
      </section>
    </VfinalPublicShell>
  )
}
