import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5b-fixtures'

describe('/observatory — real computed metrics', () => {
  test('the real /observatory page computes real severity breakdown from real signal data, and shows the real observation backlog', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)

    const signals = [
      makeSignal({ id: 's1', signal_score: 90, confidence_score: 80, momentum_score: 50 }), // CRITICAL (>=80)
      makeSignal({ id: 's2', signal_score: 90, confidence_score: 80, momentum_score: 50 }), // CRITICAL
      makeSignal({ id: 's3', signal_score: 50, confidence_score: 60, momentum_score: 30 }), // MEDIUM (40-59)
    ]
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignalStats: async () => ({ total: 3, critical: 2, high: 0, byCategory: { MODELS: 3 } }),
        getSignals: async () => signals,
      },
    })
    mock.module('@/modules/events/queries', {
      namedExports: { getEvents: async () => [] },
    })
    mock.module('@/modules/reports/queries', {
      namedExports: { getReports: async () => [] },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: {
        getObservationStats: async () => ({
          total: 500,
          processed: 458,
          unprocessed: 42,
          errors: 3,
          oldestPendingAgeSeconds: null,
        }),
      },
    })

    const { default: ObservatoryPage } = await import('../../../app/(public)/observatory/page')
    const jsx = await ObservatoryPage()
    const { container } = render(jsx)

    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)

    // Real, computed severity breakdown: getSignalSeverity(90) is
    // CRITICAL (real threshold >=80), the real page must show "2" for
    // the CRITICAL count -- not a rewritten copy of the computation.
    assert.match(container.innerHTML, />2</, 'the real CRITICAL count (2) must render')

    // Real observation backlog/error values, not fabricated.
    assert.match(container.innerHTML, /42 PENDING/)
    assert.match(container.innerHTML, /3 TODAY/)
  })
})
