/**
 * AIscentra — VfinalHeader Assistant link regression (Public
 * Interactivity Correction checkpoint)
 *
 * REAL BUG this closes (confirmed defect #2): the header's "Assistant"
 * link pointed at the `/assistant` route instead of the homepage's own
 * `#assistant` section, so clicking it from the homepage navigated
 * away instead of scrolling to that section. VfinalHeader is now a
 * client component using `usePathname()` to pick the href: `#assistant`
 * on the homepage itself, `/#assistant` from every other route. This
 * mocks `next/navigation`'s `usePathname` (via node:test's real
 * mock.module(), same established pattern as
 * src/app/signals/__tests__/opengraph-image.moduleMock.test.ts) to
 * exercise both branches against the real VfinalHeader component.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'

describe('VfinalHeader — Assistant link href by route', () => {
  test('on the homepage ("/"), the Assistant link points at the in-page "#assistant" fragment', async (t) => {
    const m = mock.module('next/navigation', {
      namedExports: { usePathname: () => '/' },
    })
    t.after(() => m.restore())

    // Cache-busting import specifier: node:test's mock.module() only
    // affects imports resolved AFTER it is called, but ESM module
    // instances are cached per exact specifier -- without this, a
    // '../vfinal-header' already loaded by an earlier test in this
    // same file/process would keep its `usePathname` binding pointed at
    // that earlier test's now-restored mock instead of picking up this
    // one.
    const { VfinalHeader } = await import(`../vfinal-header?t=${Date.now()}-1`)
    const { container } = render(<VfinalHeader />)

    const assistantLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'Assistant',
    )
    assert.ok(assistantLink, 'an Assistant link must exist')
    assert.equal(
      assistantLink?.getAttribute('href'),
      '#assistant',
      'on the homepage the Assistant link must point at the in-page fragment, not the standalone route',
    )
  })

  test('on a non-homepage route (e.g. "/events"), the Assistant link points at "/#assistant"', async (t) => {
    const m = mock.module('next/navigation', {
      namedExports: { usePathname: () => '/events' },
    })
    t.after(() => m.restore())

    const { VfinalHeader } = await import(`../vfinal-header?t=${Date.now()}-2`)
    const { container } = render(<VfinalHeader />)

    const assistantLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'Assistant',
    )
    assert.ok(assistantLink, 'an Assistant link must exist')
    assert.equal(
      assistantLink?.getAttribute('href'),
      '/#assistant',
      'from any other route the Assistant link must navigate home and land on the #assistant fragment',
    )
  })

  test('on the homepage, clicking the Assistant link scrolls to the real #assistant section instead of navigating away', async (t) => {
    const m = mock.module('next/navigation', {
      namedExports: { usePathname: () => '/' },
    })
    t.after(() => m.restore())

    const { VfinalHeader } = await import(`../vfinal-header?t=${Date.now()}-3`)

    const assistantSection = document.createElement('section')
    assistantSection.id = 'assistant'
    document.body.appendChild(assistantSection)
    t.after(() => assistantSection.remove())

    let scrolledIntoView = false
    assistantSection.scrollIntoView = () => {
      scrolledIntoView = true
    }

    const { container, unmount } = render(<VfinalHeader />)
    t.after(unmount)

    const assistantLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'Assistant',
    ) as HTMLAnchorElement
    assert.ok(assistantLink, 'an Assistant link must exist')

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    let defaultPrevented = false
    const originalPreventDefault = event.preventDefault.bind(event)
    event.preventDefault = () => {
      defaultPrevented = true
      originalPreventDefault()
    }
    assistantLink.dispatchEvent(event)

    assert.equal(
      defaultPrevented,
      true,
      'the click must be intercepted on the homepage so no full navigation occurs',
    )
    assert.equal(
      scrolledIntoView,
      true,
      'the real #assistant section must receive a scroll call (no active Lenis instance in this test, so the scrollIntoView fallback branch runs)',
    )
  })
})
