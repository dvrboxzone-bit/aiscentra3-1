'use client'

import { useAssistantPanel } from './vfinal-assistant-context'

/**
 * AIscentra — Assistant edge tab (explicit owner instruction,
 * full dated spec supplied verbatim, 2026-08-31). Every color, size,
 * spacing and typography value below is taken directly from that
 * spec -- not approximated or mapped to this site's own existing
 * palette, per the owner's own explicit final version.
 *
 * A fixed, vertical tab pinned to the right edge of the viewport
 * (does not scroll away with the page, unlike the header's own
 * "Assistant" trigger). Clicking it opens the real Assistant panel
 * via the real `useAssistantPanel().open()` context already used by
 * the header and mobile menu triggers.
 *
 * "Заезжает внутрь панели" (owner's own framing): the tab's own
 * hide-transition uses the EXACT SAME real duration/easing as the
 * panel's own real open transition (0.35s cubic-bezier(0.16, 1, 0.3,
 * 1), see .assistant-panel in globals.css) -- both motions are
 * genuinely synchronized.
 *
 * Two real text blocks (not one icon + one label): "I.O" (bold,
 * warm-white #f2f0ea, the heavier visual anchor) and "Assistant"
 * (regular weight, olive #8fa17e, the supporting label) -- separated
 * by a real thin divider line (#4d5643), both vertical (bottom-to-top
 * reading direction), matching the spec's own real composition
 * diagram exactly.
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
      <span className="assistant-tab__io">I.O</span>
      <span className="assistant-tab__divider" aria-hidden="true" />
      <span className="assistant-tab__label">Assistant</span>
    </button>
  )
}
