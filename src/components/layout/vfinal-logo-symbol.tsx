/**
 * AIscentra — vfinal logo SVG symbol definition (Frontend Design
 * Foundation, layer 2)
 *
 * Ported verbatim from AIscentra-vfinal-adapt.html's own invisible
 * <svg><defs><symbol id="aiscentra-logo">...</symbol></defs></svg>
 * block (appears once, right after <body>). VfinalHeader and
 * VfinalFooter both reference it via <use href="#aiscentra-logo" />,
 * exactly matching the HTML source's own reuse pattern -- this
 * component renders the shared symbol definition itself, once, so it
 * must be mounted near the root of any page that uses those
 * components (matches the HTML's own single top-level placement).
 */
export function VfinalLogoSymbol(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="aiscentra-logo" viewBox="0 0 180 180">
          <g transform="translate(90,90)">
            <circle r="55" fill="none" stroke="#e5e7eb" strokeWidth="3" />
            <circle r="55" fill="none" stroke="#a3f305" strokeWidth="3" strokeDasharray="90 260" />
            <path
              d="M -47.6 27.5 L 0 -55 L 47.6 27.5"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="miter"
            />
            <circle cx="0" cy="-55" r="7" fill="#a3f305" />
            <circle cx="47.6" cy="27.5" r="5" fill="#e5e7eb" />
            <circle cx="-47.6" cy="27.5" r="5" fill="#e5e7eb" />
            <circle r="14" fill="#a3f305">
              <animate
                attributeName="fill"
                values="#a3f305;#c3ff66;#a3f305"
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
