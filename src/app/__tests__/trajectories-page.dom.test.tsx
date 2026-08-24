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
describe('/trajectories — 6 real companies, real favicons, subtle per-card surface, no fabricated links', () => {
  test('renders exactly 6 real trajectory cards with real favicon URLs, the same real subtle surface fill used elsewhere on the site, and disabled "Coming soon" detail links (no fabricated destinations)', async (t) => {
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

    // REAL DESIGN DECISION REVERSED (explicit owner instruction,
    // 2026-08-24): the owner reviewed the no-fill version live and
    // asked for the per-card subtle dark surface to come back,
    // matching the exact same real pattern already used by
    // Observatory's own sub-blocks (bg-surface-tonal, #0A0A0A --
    // confirmed identical to src/app/observatory/page.tsx's own
    // section elements). Each of the 6 real cards must carry this
    // class -- not the old "text directly over the shared tech-grid,
    // zero per-card fill" decision from the prior commit.
    assert.equal(
      container.querySelectorAll('[data-content-slot="trajectory"].bg-surface-tonal').length,
      6,
      "all 6 real trajectory cards must have the real bg-surface-tonal subtle dark fill, matching Observatory's own established sub-block pattern",
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
