import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/observatory — real empty state', () => {
  test('the real /observatory page shows the real "No signals yet." empty state for category activity when getSignalStats.byCategory is empty', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignalStats: async () => ({ total: 0, critical: 0, high: 0, byCategory: {} }),
        getSignals: async () => [],
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
          total: 0,
          processed: 0,
          unprocessed: 0,
          errors: 0,
          oldestPendingAgeSeconds: null,
        }),
      },
    })
    const { default: ObservatoryPage } = await import('../../../app/(public)/observatory/page')
    const jsx = await ObservatoryPage()
    const { container } = render(jsx)
    assert.match(container.innerHTML, /No signals yet\./)
  })
})
