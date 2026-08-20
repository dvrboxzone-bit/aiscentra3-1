/**
 * AIscentra — HomePage (vfinal, layer 4): Featured Signals fixed-length
 * slots when the real query returns an EMPTY result.
 *
 * ONE test per file (confirmed real requirement -- see this test's own
 * sibling files for the full explanation of the mock.module()
 * cross-test interference this project's tooling exhibits: repeated
 * registrations for the SAME specifier across multiple tests, even
 * within one file, do not reliably take effect after the first
 * successful render). Full process isolation per scenario.
 */
import '../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { twoRealObservations, forceReducedMotion } from './homepage-fixtures'

describe('HomePage (vfinal) — Featured Signals: empty real result', () => {
  test('exactly 6 Featured Signal cards STILL render when the real query returns an EMPTY result -- missing slots become honest UNAVAILABLE cards, never fewer than 6', async (t) => {
    const restoreMatchMedia = forceReducedMotion()
    t.after(restoreMatchMedia)

    mock.module('@/modules/signals/queries', {
      namedExports: {
        getFeaturedSignals: async () => [],
        getSignals: async () => twoRealObservations(),
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: {
        getObservationStats: async () => ({
          total: 1000,
          processed: 1000,
          unprocessed: 0,
          errors: 0,
          oldestPendingAgeSeconds: null,
        }),
      },
    })

    const { default: HomePage } = await import('../page')
    const jsx = await HomePage()
    const { container } = render(jsx)

    const cards = container.querySelectorAll('[data-content-slot="signal"]')
    assert.equal(cards.length, 6, 'must still render exactly 6 cards even with zero real signals')
    const unavailableCount = Array.from(cards).filter((c) =>
      c.textContent?.includes('UNAVAILABLE'),
    ).length
    assert.equal(
      unavailableCount,
      6,
      'all 6 must be honest UNAVAILABLE placeholders, not fabricated data',
    )
  })
})
