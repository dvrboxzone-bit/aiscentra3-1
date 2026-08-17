import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/signals — a real, clean, valid page value does NOT redirect', () => {
  test('page=2 (strict positive integer) resolves normally, reaches the real getSignals() with page:2 unchanged -- no false-positive canonicalization', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let signalsCalled = false
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async (filters: { page?: number }) => {
          signalsCalled = true
          assert.equal(
            filters.page,
            2,
            'the real, clean page value must reach getSignals() unchanged',
          )
          return []
        },
        getSignalsCount: async () => 100,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({ page: '2' }) })
    assert.ok(jsx, 'a clean page=2 must resolve normally, not redirect')
    assert.ok(signalsCalled, 'getSignals must genuinely be reached for a clean page value')
  })
})
