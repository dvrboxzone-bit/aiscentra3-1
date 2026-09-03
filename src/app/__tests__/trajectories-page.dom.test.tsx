import '../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { forceReducedMotion } from './homepage-fixtures'
import { TRAJECTORIES } from '../../lib/trajectories'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

/**
 * AIscentra — /trajectories page: real regression coverage for the
 * registry table (explicit owner instruction, 2026-09-02, replacing
 * the earlier 6-card layout entirely).
 */
describe('/trajectories — real 73-entity registry table, show/hide reveal, real logo fallback chain', () => {
  test('renders a real table with one row per real registry entity, initially showing 36 with the rest behind an explicit reveal', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)

    const { default: TrajectoriesPage } = await import('../../app/(public)/trajectories/page')
    const jsx = TrajectoriesPage()
    const { container, getByRole } = render(jsx)

    // Real, honest total: the actual registry size, not a hardcoded
    // guess -- this test fails loudly if the data file's own entity
    // count ever silently drifts from what the page claims to show.
    assert.equal(TRAJECTORIES.length, 73, 'the real registry must contain exactly 73 entities')

    const allRows = container.querySelectorAll('tbody tr')
    assert.equal(
      allRows.length,
      36,
      'exactly 36 rows must be visible before the reveal is used, matching the real INITIAL_VISIBLE_COUNT',
    )

    const revealButton = getByRole('button', { name: /Show all 73 entities/ })
    assert.ok(revealButton, 'a real "show all" control naming the true total (73) must exist')

    fireEvent.click(revealButton)

    const allRowsAfterReveal = container.querySelectorAll('tbody tr')
    assert.equal(
      allRowsAfterReveal.length,
      73,
      'clicking the real reveal control must show every one of the 73 real entities, not a separate page',
    )

    // Collapsing back must work too, not just a one-way reveal.
    const collapseButton = getByRole('button', { name: /Show fewer/ })
    fireEvent.click(collapseButton)
    assert.equal(
      container.querySelectorAll('tbody tr').length,
      36,
      'the reveal control must also collapse back to 36, not just expand',
    )

    // Real table columns: the actual header text, matching the
    // registry's own recommended compact field set.
    const headerText = container.querySelector('thead')?.textContent ?? ''
    for (const column of ['Company', 'Founded', 'Founders', 'Country', 'Sphere', 'Status']) {
      assert.ok(headerText.includes(column), `the real "${column}" column header must render`)
    }

    // No pagination links -- explicit owner instruction not to split
    // this registry across separate pages.
    assert.doesNotMatch(container.innerHTML, /trajectories\/2/)
    assert.doesNotMatch(container.innerHTML, /href="#"/)
  })

  test('each real entity renders its own real company name exactly once in the full (expanded) table', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)

    const { default: TrajectoriesPage } = await import('../../app/(public)/trajectories/page')
    const jsx = TrajectoriesPage()
    const { container, getByRole } = render(jsx)
    fireEvent.click(getByRole('button', { name: /Show all 73 entities/ }))

    for (const entity of TRAJECTORIES) {
      // Starts-with, not exact-equal: 5 real entities now also show a
      // real "(also known as <brand>)" suffix (e.g. Moonshot AI / Kimi)
      // -- the cell's own text is no longer always an exact match to
      // just the bare company name for those five.
      const matches = [...container.querySelectorAll('tbody td')].filter((td) =>
        td.textContent?.trim().startsWith(entity.name),
      )
      assert.equal(matches.length, 1, `"${entity.name}" must appear exactly once in the table`)
    }
  })
})
