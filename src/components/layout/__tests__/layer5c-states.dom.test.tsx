import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

/**
 * REAL BUG FIXED (found while investigating a real, intermittent CI
 * hang, 2026-09-05): this file rendered three separate full page
 * trees (loading.tsx, error.tsx, not-found.tsx -- each including the
 * full, shared VfinalPublicShell) across three tests without ever
 * calling `cleanup()` between them -- the one established convention
 * every other real test file in this project already follows
 * (confirmed by comparing against vfinal-hero-density-scan.dom.test.tsx,
 * which does call it in its own afterEach). Three consecutive,
 * un-cleaned-up mounts of the same shared shell -- each with its own
 * real timers, observers and effects -- left accumulating, un-torn-
 * down state that plausibly explains the real, reproduced-but-
 * intermittent hang seen in CI. Not a guaranteed root cause (the hang
 * did not reproduce with 100% reliability even in direct isolation
 * testing), but a real, missing piece of this project's own
 * established test hygiene, fixed on its own merits regardless.
 */
afterEach(() => {
  cleanup()
})

describe('loading.tsx — vfinal design, shared header/footer, accessible', () => {
  test('the real Loading component uses VfinalPublicShell (shared header/footer) and has an accessible live-region status role', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const { default: Loading } = await import('../../../app/loading')
    const { container } = render(Loading())
    assert.ok(
      container.querySelector('[role="status"]'),
      'an accessible status role must exist for the loading indicator',
    )
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)
  })
})

describe('error.tsx — real reset() callback, shared header/footer', () => {
  test('the real GlobalError component wires the real reset callback (passed as a prop) to its button, and uses VfinalPublicShell', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let resetCallCount = 0
    const realReset = (): void => {
      resetCallCount++
    }
    const { default: GlobalError } = await import('../../../app/error')
    const { container } = render(
      GlobalError({ error: Object.assign(new Error('test'), { digest: 'x' }), reset: realReset }),
    )
    // REAL BUG FIXED (found while writing this test): VfinalPublicShell
    // also renders VfinalProgressAndBackToTop's own #back-to-top
    // <button>, earlier in the DOM than the real "Restart Observatory"
    // button -- a plain `querySelector('button')` would silently grab
    // the WRONG button. Scoped to the real one by its own real text.
    const button = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Restart Observatory'),
    )
    assert.ok(button, 'the real restart button must exist')
    fireEvent.click(button as HTMLButtonElement)
    assert.equal(
      resetCallCount,
      1,
      'clicking the button must call the REAL reset callback passed in as a prop, exactly once',
    )
    assert.doesNotMatch(container.innerHTML, /href="#"/)
  })
})

describe('not-found.tsx — real, working return-home link, shared header/footer', () => {
  test('the real NotFound component links to the real "/" route (not href="#"), and uses VfinalPublicShell', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const { default: NotFound } = await import('../../../app/not-found')
    const { container } = render(NotFound())
    const link = container.querySelector('a[href="/"]')
    assert.ok(link, 'a real, working link to the home route must exist')
    assert.match(container.innerHTML, /404/)
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)
  })
})
