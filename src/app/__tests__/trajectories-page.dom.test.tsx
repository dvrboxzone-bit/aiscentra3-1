import '../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from './homepage-fixtures'

/**
 * AIscentra — /trajectories page: real regression coverage for the
 * independent-review correction (explicit owner instruction).
 *
 * No mock.module() needed here -- unlike most other pages, this one
 * has NO real data-layer dependency (Supabase, AI, etc.) at all; its
 * only "data" is the static TRAJECTORIES array plus a pure function
 * (buildFaviconUrl), so it can be tested as a plain, real,
 * unconditional render.
 */
describe('/trajectories — 6 real companies, real favicons, no dark per-card fill, no fabricated links', () => {
  test('renders exactly 6 real trajectory cards with real favicon URLs, zero dark per-card background, and disabled "Coming soon" detail links (no fabricated destinations)', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)

    const { default: TrajectoriesPage } = await import('../../app/trajectories/page')
    const jsx = TrajectoriesPage()
    const { container } = render(jsx)

    // Real, honest count: exactly the 6 real companies currently
    // documented, no more, no fewer.
    assert.equal(
      container.querySelectorAll('[data-content-slot="trajectory"]').length,
      6,
      'exactly 6 real trajectory cards must render',
    )

    // Real, visual correction: no per-card dark fill anywhere on this
    // page -- text sits directly over the single shared tech-grid.
    assert.equal(
      container.querySelectorAll('.bg-surface-tonal').length,
      0,
      'no per-card dark background fill may remain -- text must sit directly over the shared tech-grid',
    )

    // Real company favicons: each of the 6 real, current company
    // domains must produce a real, correctly-formed favicon URL --
    // same honest pattern as SourceFaviconStrip, never a fabricated icon.
    for (const domain of [
      'deepmind.google',
      'getcruise.com',
      'openai.com',
      'stability.ai',
      'anthropic.com',
      'inflection.ai',
    ]) {
      assert.ok(
        container.querySelector(`img[src="https://${domain}/favicon.ico"]`),
        `the real favicon for ${domain} must render`,
      )
    }

    // Honest "Coming soon": no fabricated /history/ or similar detail
    // links -- the owner's own stated future plan (real detail pages)
    // has not been built yet, so none may be faked here.
    assert.equal(
      container.querySelectorAll('a[href*="/history/"]').length,
      0,
      'no fabricated detail-page links may exist until real detail pages are built',
    )
    assert.equal(
      container.querySelectorAll('[aria-disabled="true"]').length,
      6,
      'all 6 "Full trajectory" links must remain honestly disabled',
    )

    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
  })
})
