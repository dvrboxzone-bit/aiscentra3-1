import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Status',
  description:
    'AIscentra Status will report the real, current operational state of the signal pipeline — not a decorative "all systems normal" badge.',
}

/**
 * AIscentra — /status page (explicit owner instruction, 2026-09-03).
 * Real, dedicated standalone page, replacing plain non-clickable
 * footer text with a real link and a real "coming soon" page -- same
 * established pattern as /forecasts, /editorial, /emerging-patterns,
 * /strategic-memory (textured-bg + tech-grid, IN DEVELOPMENT banner).
 *
 * Deliberately does NOT render a static "all systems operational"
 * claim -- that would be a fabricated status this project's own
 * evidence-first principle explicitly forbids (this session's own
 * real audit found the Signal pipeline has real, open reliability
 * questions). The real page will need genuine backend data (last
 * successful pipeline run, real uptime) before it can honestly show
 * a status at all -- until then, only the honest absence of a claim.
 */
export default function StatusPage(): React.JSX.Element {
  return (
    <>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[640px]">
          <span className="font-caption mb-4 block text-mint-signal">
            REAL STATE, NOT A DECORATIVE BADGE
          </span>
          <h1 className="font-display mb-10 text-[10vw] text-frost md:text-[56px]">Status.</h1>
          <p className="mb-10 text-lg text-silver-haze">
            This page will report the real, current operational state of the Observatory&rsquo;s
            signal pipeline — when it last ran, whether it completed, and what it processed. We
            won&rsquo;t show a decorative &ldquo;all systems normal&rdquo; badge before that data is
            genuinely available and genuinely true.
          </p>
          <div className="border border-border-subtle bg-surface-tonal p-6">
            <span className="font-caption block text-silver-haze">
              STATUS PAGE — IN DEVELOPMENT
            </span>
          </div>
        </div>
      </section>
    </>
  )
}
