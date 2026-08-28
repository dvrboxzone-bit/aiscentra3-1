/**
 * AIscentra — vfinal logo SVG symbol definition.
 *
 * VfinalHeader, VfinalFooter and VfinalAssistantPanel all reference
 * this shared symbol via <use href="#aiscentra-logo" /> -- this
 * component renders the definition once, so it must be mounted near
 * the root of any page using those components.
 *
 * Mark redesigned 2026-08-28 (explicit owner instruction, exact SVG
 * files supplied by the owner): two adjacent bordered frames -- left
 * frame contains the letter "A" (AIscentra's own first letter),
 * right frame contains "I.O" (Intelligence Observatory, matching the
 * site's real existing hero heading text verbatim). Deliberately
 * NOT collapsed into "AIO" -- researched and confirmed this exact
 * three-letter acronym is heavily overloaded in the current AI
 * industry (Google's own "AI Overview" search feature, "AI
 * Optimization", AIOps), a real, meaningful brand-confusion risk the
 * two-frame layout with a visible period avoids entirely.
 *
 * Real aspect ratio preserved from the owner's own supplied SVG
 * (500x200, ~2.5:1) -- consumers set only a height (56px, matching
 * the size already proven and approved in the Assistant panel) and
 * let width scale proportionally via the viewBox, rather than forcing
 * a square box like the prior single-mark logo.
 */
export function VfinalLogoSymbol(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="aiscentra-logo" viewBox="0 0 500 200">
          <rect
            x="40"
            y="40"
            width="180"
            height="120"
            fill="none"
            stroke="#8B9D83"
            strokeWidth="3"
          />
          <text
            x="130"
            y="128"
            textAnchor="middle"
            fontFamily="Arial, Helvetica, sans-serif"
            fontWeight="700"
            fontSize="72"
            fill="#8B9D83"
          >
            A
          </text>
          <rect
            x="280"
            y="40"
            width="180"
            height="120"
            fill="none"
            stroke="#8B9D83"
            strokeWidth="3"
          />
          <text
            x="370"
            y="122"
            textAnchor="middle"
            fontFamily="Arial, Helvetica, sans-serif"
            fontWeight="700"
            fontSize="56"
            fill="#E5E7EB"
            letterSpacing="6"
          >
            I.O
          </text>
        </symbol>
      </defs>
    </svg>
  )
}
