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
      namedExports: { getSignals: async () => [] },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({}) })
    const { container } = render(jsx)
    // Real observation: VfinalHeader's own Signals dropdown (part of
    // VfinalPublicShell, rendered on every page) ALSO contains the
    // same 9 real category links -- scoping to the page's own filter
    // bar specifically (not the whole document) avoids double-counting
    // that separate, already-tested navigation element.
    const main = container.querySelector('main')
    assert.ok(main, 'a <main> element must exist')
    const links = Array.from(main?.querySelectorAll('a[href^="/signals?category="]') ?? [])
    assert.equal(
      links.length,
      9,
      "all 9 real categories must produce a real filter link in the page's own filter bar",
    )
    assert.doesNotMatch(container.innerHTML, /href="#"/)
  })
})
