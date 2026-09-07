import Link from 'next/link'

export type ConfidenceLevelId = 'evidence' | 'signal' | 'trajectory' | 'pattern' | 'forecast'

interface LevelDef {
  id: ConfidenceLevelId
  label: string
  href: string | null
  /** REAL BUG FIXED before this ever shipped (found via a live
      screenshot check before finalizing): Evidence has no dedicated
      page of its own (it lives inside the Signal detail page), but it
      is a genuinely real, working part of the pipeline -- not
      "in development" the way Pattern and Forecast actually are
      (both real, current site placeholders). `href: null` alone
      cannot distinguish these two real, different cases; this flag
      does. */
  built: boolean
}

const LEVELS: readonly LevelDef[] = [
  { id: 'evidence', label: 'Evidence', href: null, built: true },
  { id: 'signal', label: 'Signal', href: '/signals', built: true },
  { id: 'trajectory', label: 'Trajectory', href: '/trajectories', built: true },
  { id: 'pattern', label: 'Pattern', href: null, built: false },
  { id: 'forecast', label: 'Forecast', href: null, built: false },
]

/**
 * AIscentra — shared confidence-level bar (explicit owner instruction,
 * 2026-09-06, following a real, agreed-upon "as-is / to-be" plan the
 * owner reviewed and approved before any code was written).
 *
 * Real principle behind this component (from the owner's own real
 * analysis of two real competitors -- Envisioning Signals and Epoch
 * AI -- checked directly, not from memory): AIscentra's own real
 * sections are not independent, equal features the way a
 * competitor's menu items are. They are stages of one real pipeline,
 * already established in this project's own Redaction 3:
 *   Evidence -> Claim -> Signal -> Trajectory -> Pattern -> Forecast
 * The real problem this component fixes: the site's own navigation
 * previously presented these as a flat, equal-weight list, which
 * genuinely contradicts the real underlying architecture. This bar
 * shows the real vertical relationship directly, on every real page
 * where it applies.
 *
 * Honest, deliberate limitation (explicit owner instruction): "Pattern"
 * and "Forecast" have no real page yet (/emerging-patterns and
 * /forecasts are both real, current "IN DEVELOPMENT" placeholders) --
 * their entries here are NOT links. Rendering them as fake, dead
 * links would be a real, avoidable dishonesty; this component instead
 * shows them dimmed with a real, plain "in development" note, exactly
 * matching what those pages themselves already say.
 */
export function VfinalConfidenceBar({
  active,
}: {
  /** Which real level(s) the current page represents. */
  active: readonly ConfidenceLevelId[]
}): React.JSX.Element {
  return (
    <div
      className="mb-10 flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border-subtle pb-6"
      aria-label="Confidence level"
    >
      {LEVELS.map((level, i) => {
        const isActive = active.includes(level.id)
        const content = (
          <span
            className={`font-caption ${isActive ? 'text-mint-signal' : level.built ? 'text-silver-haze' : 'text-silver-haze opacity-40'}`}
          >
            {level.label.toUpperCase()}
            {!level.built && <span className="ml-1 text-[10px] normal-case">(in development)</span>}
          </span>
        )
        return (
          <span key={level.id} className="flex items-center gap-2">
            {level.href && !isActive ? (
              <Link href={level.href} className="hover:underline">
                {content}
              </Link>
            ) : (
              content
            )}
            {i < LEVELS.length - 1 && <span className="text-border-subtle">→</span>}
          </span>
        )
      })}
    </div>
  )
}
