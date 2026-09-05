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

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { VfinalHeader } from '../vfinal-header'
import { VfinalAssistantPanelProvider } from '../vfinal-assistant-context'
import { VfinalAssistantPanel } from '../vfinal-assistant-panel'

afterEach(() => {
  cleanup()
})

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

    // REAL BUG FOUND AND FIXED (owner-reported, live production/preview
    // testing, 2026-08-23): the real component originally applied the
    // `open` class ONLY to the outer overlay div, never to the
    // `.assistant-panel` element itself (the real <aside> with
    // role="dialog") -- meaning the dark overlay correctly faded in on
    // click, but the sliding panel itself never actually transformed
    // into view (permanently stuck at transform: translateX(100%)).
    // This exact test file's OWN prior version had a matching mistake
    // that masked the bug: it asserted
    // `dialogElement.parentElement.classList.contains('open')` --
    // checking the PARENT (the overlay) instead of the dialog element
    // itself -- so it passed even though the real panel was broken.
    // Both the component and this assertion are now fixed to check the
    // real `.assistant-panel` element's own class directly.
    const dialogBeforeOpen = container.querySelector(
      '[role="dialog"][aria-label="Observatory Assistant"]',
    )
    assert.ok(dialogBeforeOpen, 'the real panel element exists in the DOM even before opening')
    assert.equal(
      dialogBeforeOpen?.classList.contains('open'),
      false,
      'the real panel element itself must not have the open class before it is opened',
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
      dialogAfterOpen?.classList.contains('open'),
      true,
      'the real panel element itself must genuinely gain the open class after the button is clicked -- checking classList directly on the dialog element, not its parent',
    )
  })
})
