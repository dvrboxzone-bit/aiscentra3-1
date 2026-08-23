/**
 * AIscentra — VfinalHeader Assistant button regression
 * (independent-review correction, explicit owner instruction)
 *
 * REAL ARCHITECTURE CHANGE this test now covers: the header's
 * "Assistant" element is no longer a Link that scrolls to a homepage
 * anchor (#assistant) -- that whole section was removed from the
 * homepage. It is now a real <button> that opens the real sliding
 * VfinalAssistantPanel (via VfinalAssistantPanelProvider's own real
 * open() function) on ANY page, not just the homepage. The prior
 * version of this test file asserted the old anchor-scrolling
 * behavior -- fully rewritten here to match the new real behavior,
 * not merely patched.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { render, fireEvent } from '@testing-library/react'
import { VfinalHeader } from '../vfinal-header'
import { VfinalAssistantPanelProvider } from '../vfinal-assistant-context'
import { VfinalAssistantPanel } from '../vfinal-assistant-panel'

describe('VfinalHeader — Assistant button opens the real sliding panel', () => {
  test('the Assistant element is a real button (not a Link with an href) on both the desktop and mobile-menu placements', () => {
    const { container } = render(
      <VfinalAssistantPanelProvider>
        <VfinalHeader />
      </VfinalAssistantPanelProvider>,
    )

    const assistantButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Assistant',
    )
    assert.equal(
      assistantButtons.length,
      2,
      'exactly 2 real Assistant buttons must exist (desktop nav + mobile menu)',
    )
    for (const btn of assistantButtons) {
      assert.equal(btn.getAttribute('type'), 'button', 'must be a real button, not a submit')
    }
    assert.equal(
      Array.from(container.querySelectorAll('a')).some((a) => a.textContent?.trim() === 'Assistant'),
      false,
      'no <a> element may still be labeled Assistant -- it is genuinely no longer a navigable link',
    )
  })

  test('clicking the Assistant button genuinely opens the real sliding panel (VfinalAssistantPanel becomes visible)', () => {
    function TestApp(): React.JSX.Element {
      return (
        <VfinalAssistantPanelProvider>
          <VfinalHeader />
          <VfinalAssistantPanel />
        </VfinalAssistantPanelProvider>
      )
    }
    const { container } = render(<TestApp />)

    // Real, honest initial state: the panel renders nothing (returns
    // null) until genuinely opened.
    assert.equal(
      container.querySelector('[role="dialog"][aria-label="Observatory Assistant"]'),
      null,
      'the real panel must not be in the DOM before it is opened',
    )

    const assistantButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Assistant',
    ) as HTMLButtonElement
    assert.ok(assistantButton, 'the real Assistant button must exist')

    fireEvent.click(assistantButton)

    assert.ok(
      container.querySelector('[role="dialog"][aria-label="Observatory Assistant"]'),
      'the real panel must genuinely appear in the DOM after the button is clicked',
    )
  })
})
