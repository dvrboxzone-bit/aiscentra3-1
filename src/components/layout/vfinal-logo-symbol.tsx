/**
 * AIscentra — vfinal logo SVG symbol definition.
 *
 * VfinalHeader, VfinalFooter and VfinalAssistantPanel all reference
 * this shared symbol via <use href="#aiscentra-logo" /> -- this
 * component renders the definition once, so it must be mounted near
 * the root of any page using those components.
 *
 * Mark redesigned 2026-08-27 (explicit owner instruction, reference
 * image supplied): 7 stacked rounded bars of increasing width form a
 * pyramid silhouette; a white parallelogram "leg" sits to the right,
 * offset from the bars by the same real gap measured between the
 * bars themselves. Bar/gap/leg coordinates were measured directly
 * from the reference image (pixel-level color-mask analysis), not
 * estimated by eye. The 3rd and 4th bars from the bottom are white,
 * per the owner's own follow-up instruction; all others are the
 * site's real mint-signal accent color.
 */
export function VfinalLogoSymbol(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="aiscentra-logo" viewBox="0 0 180 180">
          <rect x="82.11" y="31.14" width="17.97" height="9.17" rx="4.58" fill="#8B9D83" />
          <rect x="71.11" y="49.47" width="34.84" height="8.8" rx="4.4" fill="#8B9D83" />
          <rect x="59.74" y="67.44" width="51.71" height="8.8" rx="4.4" fill="#8B9D83" />
          <rect x="48.74" y="85.78" width="68.58" height="8.44" rx="4.22" fill="#ffffff" />
          <rect x="37.37" y="103.75" width="85.45" height="8.8" rx="4.4" fill="#ffffff" />
          <rect x="26.0" y="121.36" width="102.32" height="9.17" rx="4.58" fill="#8B9D83" />
          <rect x="15.0" y="140.06" width="119.19" height="8.8" rx="4.4" fill="#8B9D83" />
          <polygon points="107.91,31.5 137.62,31.5 174.29,148.5 144.58,148.5" fill="#ffffff" />
        </symbol>
      </defs>
    </svg>
  )
}
