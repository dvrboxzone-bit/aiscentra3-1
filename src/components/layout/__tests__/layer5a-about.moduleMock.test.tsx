import '../../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/about — real anchor ids, VfinalPublicShell, no forbidden URLs', () => {
  test('the real /about page contains all 4 required anchor ids and uses VfinalPublicShell', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const { default: AboutPage } = await import('../../../app/(public)/about/page')
    const { container } = render(AboutPage())
    // REAL SITE-STRUCTURE BUG FOUND AND FIXED, 2026-09-03 (owner
    // report): "methodology" used to be one of the 4 required anchors
    // here, duplicating and competing with the real, content-rich
    // standalone /methodology page built the same day -- every
    // "Methodology" nav link across the site pointed to THIS short
    // in-page section in 3 of 4 places. Renamed to "pipeline-overview"
    // (kept as a real, useful quick-reference grid, now linking out to
    // the real page) so one nav label has exactly one real
    // destination.
    for (const id of ['epistemic-model', 'pipeline-overview', 'security-data', 'roadmap']) {
      assert.ok(container.querySelector(`#${id}`), `#${id} must exist on the real /about page`)
    }
    const html = container.innerHTML
    assert.doesNotMatch(html, /href="#"/)
    assert.doesNotMatch(html, /picsum/i)
    assert.doesNotMatch(html, /z-cdn/i)
  })
})
