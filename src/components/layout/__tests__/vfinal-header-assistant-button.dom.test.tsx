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
      Array.from(container.querySelectorAll('a')).some(
        (a) => a.textContent?.trim() === 'Assistant',
      ),
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

    // REAL ARCHITECTURE CHANGE (independent-review visual correction,
    // explicit owner instruction): the panel is now ALWAYS mounted
    // (real CSS transform/visibility transition, matching the
    // established .mobile-menu-panel slide pattern) so both entry AND
    // exit are genuinely smooth -- unlike the prior `if (!isOpen)
    // return null` version, the dialog element itself now genuinely
    // exists in the DOM even while closed, just visually
    // transformed off-screen via the .assistant-panel CSS class
    // (no `.open` class yet). Real openness is therefore asserted via
    // the real `.open` class, not DOM presence.
    //
    // Also note: comparing a real DOM Element directly against `null`
    // via assert.equal (rather than a boolean .ok()/.equal(x, true)
    // check) is itself a real footgun -- Node's own assertion-error
    // formatter must serialize the full DOM node (with its circular
    // parentNode/childNodes graph) to build a diff message on
    // failure, which can take a very long time and looks exactly like
    // a hang rather than a clean failure. Using .ok()/boolean checks
    // throughout avoids ever constructing that diff.
    const dialogBeforeOpen = container.querySelector(
      '[role="dialog"][aria-label="Observatory Assistant"]',
    )
    assert.ok(dialogBeforeOpen, 'the real panel element exists in the DOM even before opening')
    assert.equal(
      dialogBeforeOpen?.parentElement?.classList.contains('open'),
      false,
      'the real panel must not have the open class before it is opened',
    )

    const assistantButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Assistant',
    ) as HTMLButtonElement
    assert.ok(assistantButton, 'the real Assistant button must exist')

    fireEvent.click(assistantButton)

    const dialogAfterOpen = container.querySelector(
      '[role="dialog"][aria-label="Observatory Assistant"]',
    )
    assert.ok(dialogAfterOpen, 'the real panel element still exists in the DOM after opening')
    assert.equal(
      dialogAfterOpen?.parentElement?.classList.contains('open'),
      true,
      'the real panel must genuinely gain the open class after the button is clicked',
    )
  })
})
