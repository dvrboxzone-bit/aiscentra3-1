import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/signals — real category filter links', () => {
  test('the real /signals category filter still produces real /signals?category=X links, no href="#"', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/signals/queries', {
      namedExports: { getSignals: async () => [], getSignalsCount: async () => 0 },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/(public)/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({}) })
    const { container } = render(jsx)
    // Real architectural change (Task 7, 2026-09-01): VfinalHeader
    // (and its own duplicate Signals dropdown links) now lives in the
    // (public) route group's shared layout.tsx, not inside this page
    // itself -- rendering SignalsPage() in isolation here, as this
    // test does, no longer includes the header at all, so scoping to
    // a <main> boundary to avoid double-counting the header's own
    // links is no longer necessary; querying the whole container is
    // now equivalent and no longer risks that collision.
    const links = Array.from(container.querySelectorAll('a[href^="/signals?category="]'))
    assert.equal(
      links.length,
      9,
      "all 9 real categories must produce a real filter link in the page's own filter bar",
    )
    assert.doesNotMatch(container.innerHTML, /href="#"/)
  })
})
