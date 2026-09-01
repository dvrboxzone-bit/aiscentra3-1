import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Forecasts',
  description:
    'AIscentra Forecasts will connect converging signals into time-bound, testable predictions.',
}

/**
 * AIscentra — /forecasts page (explicit owner instruction). Real,
 * dedicated standalone page for Forecasts, previously only a
 * homepage section with no real link target ("EXPLORE FORECASTS"
 * was rendered as inert text, title="Not yet available"). Same real
 * textured-bg + tech-grid pattern already established elsewhere.
 * Copy proposed and reviewed with the owner during planning, not
 * owner-authored verbatim like /editorial and /emerging-patterns.
 */
export default function ForecastsPage(): React.JSX.Element {
  return (
    <>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[640px]">
          <span className="font-caption mb-4 block text-mint-signal">
            FROM SIGNALS TO FORESIGHT
          </span>
          <h1 className="font-display mb-10 text-[10vw] text-frost md:text-[56px]">Forecasts.</h1>
          <p className="mb-10 text-lg text-silver-haze">
            AIscentra Forecasts will connect converging signals, verified evidence and historical
            patterns into time-bound, testable predictions of what may happen next in AI. Every
            forecast will disclose its probability, resolution criteria and evidence — and every
            outcome will be measured openly, so accuracy is demonstrated, not claimed.
          </p>
          <div className="border border-border-subtle bg-surface-tonal p-6">
            <span className="font-caption block text-silver-haze">
              FORECAST ENGINE — IN DEVELOPMENT
            </span>
          </div>
        </div>
      </section>
    </>
  )
}
