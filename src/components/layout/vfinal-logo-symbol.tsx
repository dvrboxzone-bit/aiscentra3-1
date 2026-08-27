/**
 * AIscentra — vfinal logo SVG symbol definition (Frontend Design
 * Foundation, layer 2)
 *
 * Originally ported verbatim from AIscentra-vfinal-adapt.html's own
 * invisible <svg><defs><symbol id="aiscentra-logo">...</symbol></defs></svg>
 * block. VfinalHeader and VfinalFooter both reference it via
 * <use href="#aiscentra-logo" />, exactly matching the HTML source's
 * own reuse pattern -- this component renders the shared symbol
 * definition itself, once, so it must be mounted near the root of any
 * page that uses those components (matches the HTML's own single
 * top-level placement).
 *
 * Visual correction (explicit owner instruction, 2026-08-26,
 * reviewed against two real rendered reference images across two
 * rounds of feedback): the mark is intentionally bolder than the
 * original HTML source now -- circle and triangle stroke width
 * increased 3 -> 4.5. All three vertex dots are now equal size
 * (r=7 each) -- the first pass made them proportionally different
 * (top 10, base 7 each, mirroring the original's own 7/5/5 asymmetry
 * scaled up), but the owner's own follow-up correction specified all
 * three must be identical, not merely proportional to their old
 * asymmetric sizes; the base dots' own r=7 was already correct, so
 * only the top dot was reduced from 10 to match. The center pulse dot
 * (the separate, already-larger animated r=14 circle) was NOT
 * touched -- the owner's own instruction specifically named the 3
 * triangle-vertex dots, not the center. This is a deliberate
 * departure from strict verbatim-port fidelity to the original
 * static HTML, not an unintended drift.
 */
export function VfinalLogoSymbol(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="aiscentra-logo" viewBox="0 0 180 180">
          <g transform="translate(90,90)">
            <circle r="55" fill="none" stroke="#e5e7eb" strokeWidth="4.5" />
            <circle
              r="55"
              fill="none"
              stroke="#8B9D83"
              strokeWidth="4.5"
              strokeDasharray="90 260"
            />
            <path
              d="M -47.6 27.5 L 0 -55 L 47.6 27.5"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="miter"
            />
            <circle cx="0" cy="-55" r="7" fill="#8B9D83" />
            <circle cx="47.6" cy="27.5" r="7" fill="#e5e7eb" />
            <circle cx="-47.6" cy="27.5" r="7" fill="#e5e7eb" />
            <circle r="14" fill="#8B9D83">
              <animate
                attributeName="fill"
                values="#8B9D83;#b5c3ae;#8B9D83"
                dur="4s"
                repeatCount="indefinite"
              />
              <animate attributeName="r" values="14;15;14" dur="4s" repeatCount="indefinite" />
            </circle>
          </g>
        </symbol>
      </defs>
    </svg>
  )
}
