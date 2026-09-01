import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description:
    "The short version: read freely, quote with attribution, don't claim our analysis as yours. Full terms below, no legal filler.",
}

/**
 * AIscentra — /terms page. Real, minimal terms of use for an
 * informational project -- text specified verbatim by the owner. No
 * refund/subscription/SLA/enterprise-agreement language, since none
 * of those apply to this project's real, current scope.
 */
export default function TermsPage(): React.JSX.Element {
  return (
    <>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[760px]">
          <span className="font-caption mb-4 block text-mint-signal">LEGAL</span>
          <h1 className="font-display mb-4 text-[10vw] text-frost md:text-[56px]">Terms of Use.</h1>
          <p className="font-caption mb-12 text-silver-haze">Last updated: August 23, 2026</p>
          <div className="space-y-6 text-lg leading-relaxed text-silver-haze">
            <p>AIscentra is an independent AI intelligence observatory.</p>
            <p>
              All content is provided for general informational purposes only. Signals, analyses,
              trajectories, and forecasts may contain inaccuracies, may become outdated, and may be
              changed without notice.
            </p>
            <p>
              Nothing on AIscentra constitutes financial, investment, legal, business, medical, or
              other professional advice. You are responsible for decisions made based on information
              available on this website.
            </p>
            <p>
              You may link to publicly available AIscentra pages with attribution. You may not
              systematically scrape, reproduce, republish, resell, or redistribute substantial
              portions of the website without prior permission.
            </p>
            <p>AIscentra may modify, suspend, or remove content and functionality at any time.</p>
            <p>
              For questions about these terms:{' '}
              <a href="mailto:aiscentra@gmail.com" className="text-mint-signal hover:underline">
                aiscentra@gmail.com
              </a>
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
