/**
 * AIscentra — neutral semantic image slot (Frontend Design Foundation,
 * layer 4)
 *
 * The HTML source's own image slots (Featured Signals, Forecasts,
 * Observations, History) all point to temporary z-cdn-media.chatglm.cn
 * signed URLs with a Picsum onerror fallback. Task explicitly forbids
 * both (Picsum, stock URLs, temporary z-cdn/signed URLs) and forbids
 * creating a photo library at this layer -- this component preserves
 * the exact geometry (aspect ratio, sizing classes are passed through
 * by the caller, same as the HTML's own per-slot classes) with a
 * stable, neutral panel instead, ready to be swapped for a real photo
 * once the approved photo folder exists in a later, separate task.
 *
 * `imgMono` reproduces the visual weight of the HTML's own `.img-mono`
 * treatment (a desaturated panel) without needing any actual image
 * asset.
 */
export function VfinalImageSlot({
  className = '',
  label,
}: {
  className?: string
  /** Optional short label rendered centered in the neutral panel (e.g.
   * "SIGNAL ILLUSTRATION") -- purely a visual placeholder cue, not
   * real content. */
  label?: string
}): React.JSX.Element {
  return (
    <div
      className={`img-mono flex items-center justify-center bg-surface-tonal ${className}`}
      data-image-slot="neutral-placeholder"
      role="img"
      aria-label={label ?? 'Image not yet available'}
    >
      {label ? (
        <span className="font-caption select-none text-silver-haze opacity-30">{label}</span>
      ) : null}
    </div>
  )
}
