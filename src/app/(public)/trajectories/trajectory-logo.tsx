'use client'

/**
 * AIscentra — real company favicon with an honest, non-fabricated
 * fallback (hides itself on load failure -- see trajectories/page.tsx
 * own docstring for full reasoning). Extracted as its own small client
 * component because the parent /trajectories page is a real Server
 * Component and event handlers (onError) cannot be passed as props to
 * a plain DOM element rendered from server code.
 */
export function TrajectoryLogo({ src }: { src: string }): React.JSX.Element {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, unknown-dimension logo across a real three-source fallback chain; next/image would require remotePatterns for every possible source domain
    <img
      src={src}
      alt=""
      width={28}
      height={28}
      className="shrink-0"
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}
