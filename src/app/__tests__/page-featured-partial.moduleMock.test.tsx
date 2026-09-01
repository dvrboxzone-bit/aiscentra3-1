/**
 * AIscentra — HomePage (vfinal, layer 4): Featured Signals fixed-length
 * slots when the real query returns a PARTIAL result.
 *
 * ONE test per file -- see page-featured-empty.moduleMock.test.tsx's
 * own docstring for the full explanation of the real mock.module()
 * cross-test interference this project's tooling exhibits.
 */
import '../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { sixRealSignals, twoRealObservations, forceReducedMotion } from './homepage-fixtures'

describe('HomePage (vfinal) — Featured Signals: partial real result', () => {
  test('exactly 6 Featured Signal cards render with a PARTIAL result (3 real + 3 honest UNAVAILABLE)', async (t) => {
    const restoreMatchMedia = forceReducedMotion()
    t.after(restoreMatchMedia)

    const partial = sixRealSignals().slice(0, 3)
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getFeaturedSignals: async () => partial,
        getSignals: async () => twoRealObservations(),
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

    const cards = container.querySelectorAll('[data-content-slot="signal"]')
    assert.equal(cards.length, 6)
    const unavailableCount = Array.from(cards).filter((c) =>
      c.textContent?.includes('UNAVAILABLE'),
    ).length
    assert.equal(unavailableCount, 3, '3 real + 3 UNAVAILABLE must sum to exactly 6')
  })
})
