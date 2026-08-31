'use client'

import { useAssistantPanel } from './vfinal-assistant-context'

/**
 * AIscentra — Assistant edge tab (explicit owner instruction,
 * 2026-08-30/31, exact design brief + reference HTML/CSS/icon assets
 * supplied by the owner).
 *
 * A fixed, vertical tab pinned to the right edge of the viewport
 * (does not scroll away with the page, unlike the header's own
 * "Assistant" trigger). Clicking it opens the real Assistant panel
 * via the SAME real context (`useAssistantPanel().open()`) already
 * used by the header and mobile menu triggers -- the reference
 * archive's own JS used a custom-event stub (`assistant:open`/
 * `assistant:close`) as a generic integration point since it didn't
 * know this project's real panel code; this project already has a
 * real, typed React Context for exactly this, so the custom-event
 * layer is intentionally not used -- wiring directly to the real
 * function is more correct, not less faithful to the brief.
 *
 * "Заезжает внутрь панели" (owner's own framing): the tab's own
 * hide-transition uses the EXACT SAME real duration/easing as the
 * panel's own real open transition (0.35s cubic-bezier(0.16, 1, 0.3,
 * 1), see .assistant-panel in globals.css) -- both motions are
 * genuinely synchronized, so the tab appears to slide into the same
 * moment the panel's own logo becomes visible from the same edge, a
 * real continuous motion rather than two independently-timed effects.
 * The tab shows the single-frame "I.O" mark (matching the real
 * favicon design) rather than the panel's own wider two-frame
 * lockup -- the tab's real width (52px) cannot fit the two-frame
 * mark's own real 140x56 proportions; using the same wide mark here
 * would require fabricating a design compromise not in the owner's
 * own supplied assets.
 *
 * Colors: CSS variables only (--tab-bg, --tab-border, --tab-text),
 * matching the owner's own explicit "no hardcoded colors" requirement
 * from the supplied component, mapped to this site's real existing
 * palette (mint-signal / deep-obsidian / border-subtle) rather than
 * the reference file's own placeholder hex values.
 */
export function VfinalAssistantTab(): React.JSX.Element {
  const { isOpen, open } = useAssistantPanel()

  return (
    <button
      type="button"
      className={`assistant-tab ${isOpen ? 'is-hidden' : ''}`}
      onClick={open}
      aria-label="Open Assistant"
      aria-controls="assistant-panel"
      aria-expanded={isOpen}
    >
      <svg width="22" height="22" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <rect
          x="4"
          y="4"
          width="56"
          height="56"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
        <text
          x="32"
          y="42"
          textAnchor="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="700"
          fontSize="24"
          fill="currentColor"
          letterSpacing="2"
        >
          I.O
        </text>
      </svg>
      <span className="assistant-tab__label">ASSISTANT</span>
    </button>
  )
}
