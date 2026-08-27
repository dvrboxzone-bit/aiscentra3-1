/**
 * AIscentra — vfinal logo SVG symbol definition.
 *
 * VfinalHeader, VfinalFooter and VfinalAssistantPanel all reference
 * this shared symbol via <use href="#aiscentra-logo" /> -- this
 * component renders the definition once, so it must be mounted near
 * the root of any page using those components.
 *
 * Mark redesigned 2026-08-27 (explicit owner instruction, reference
 * image supplied): a faceted "A" silhouette -- left leg white, right
 * leg the site's real mint-signal accent, meeting at a shared peak
 * with a real gap between the two legs' lower ends. Geometry was
 * measured directly from the reference image via pixel-level
 * silhouette/color analysis (row-by-row segment detection plus
 * linear regression on all four edges), not estimated by eye. Kept
 * as flat, solid fills (no facet subdivisions or gradient shading, per
 * explicit owner instruction) to match the rest of the site's own
 * flat-color visual language.
 */
export function VfinalLogoSymbol(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="aiscentra-logo" viewBox="0 0 180 180">
          <polygon points="90.21,15.0 59.07,72.73 90.21,72.73" fill="#ffffff" />
          <polygon points="90.21,15.0 90.21,72.73 121.29,72.73" fill="#8B9D83" />
          <polygon points="59.07,72.73 90.21,72.73 33.78,165.0 9.34,165.0" fill="#ffffff" />
          <polygon points="90.21,72.73 121.29,72.73 170.66,164.18 146.39,164.18" fill="#8B9D83" />
        </symbol>
      </defs>
    </svg>
  )
}
