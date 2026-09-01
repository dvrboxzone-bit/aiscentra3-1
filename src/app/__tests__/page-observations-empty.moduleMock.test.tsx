/**
 * AIscentra — HomePage (vfinal, layer 4): Observations fixed-length
 * slots when the real query returns an EMPTY candidate pool.
 *
 * ONE test per file -- see page-featured-empty.moduleMock.test.tsx's
 * own docstring for the full explanation of the real mock.module()
 * cross-test interference this project's tooling exhibits.
 */
import '../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { sixRealSignals, forceReducedMotion } from './homepage-fixtures'

describe('HomePage (vfinal) — Observations: empty real result', () => {
  test('exactly 2 Observation cards STILL render when the real pool is empty -- both become honest UNAVAILABLE cards, never fewer than 2', async (t) => {
    const restoreMatchMedia = forceReducedMotion()
    t.after(restoreMatchMedia)

    mock.module('@/modules/signals/queries', {
      namedExports: {
        getFeaturedSignals: async () => sixRealSignals(),
        getSignals: async () => [],
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: {
        getObservationStats: async () => ({
          total: 1000,
          processed: 958,
          unprocessed: 42,
          errors: 0,
          oldestPendingAgeSeconds: null,
        }),
      },
    })

    const { default: HomePage } = await import('../(public)/page')
    const jsx = await HomePage()
    const { container } = render(jsx)

    const cards = container.querySelectorAll('[data-content-slot="observation"]')
    assert.equal(
      cards.length,
      2,
      'must still render exactly 2 cards even with zero real observation candidates',
    )
    assert.ok(
      Array.from(cards).every((c) => c.textContent?.includes('UNAVAILABLE')),
      'both must be honest UNAVAILABLE placeholders',
    )
  })
})
