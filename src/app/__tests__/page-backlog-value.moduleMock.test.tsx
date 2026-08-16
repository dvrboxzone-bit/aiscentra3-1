/**
 * AIscentra — HomePage (vfinal, layer 4): the Observatory backlog value
 * is genuinely wired from getObservationStats(), not a fabricated
 * number.
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

describe('HomePage (vfinal) — Observatory backlog: real data wiring', () => {
  test('the real, injected unprocessed count appears verbatim on the rendered page -- not a fabricated or default number', async (t) => {
    const restoreMatchMedia = forceReducedMotion()
    t.after(restoreMatchMedia)

    mock.module('@/modules/signals/queries', {
      namedExports: {
        getFeaturedSignals: async () => sixRealSignals(),
        getSignals: async () => twoRealObservations(),
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: {
        getObservationStats: async () => ({
          total: 1000,
          processed: 223,
          unprocessed: 777,
          errors: 0,
          oldestPendingAgeSeconds: null,
        }),
      },
    })

    const { default: HomePage } = await import('../page')
    const jsx = await HomePage()
    const { container } = render(jsx)

    assert.match(
      container.innerHTML,
      /777/,
      'the real, injected unprocessed count must appear verbatim',
    )
  })
})
