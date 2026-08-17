import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5b-fixtures'

describe('/signals — the real last page is an inclusive, valid boundary', () => {
  test('page equal to the real last page (page=6 of 6) does NOT 404 -- the boundary is genuinely inclusive', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const lastPageSignals = Array.from({ length: 25 }, (_, i) => makeSignal({ id: `last-${i}` }))
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => lastPageSignals,
        getSignalsCount: async () => 150,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    // Must resolve normally (not throw/reject) -- page 6 is the real
    // last valid page for 150 signals at 25/page.
    const jsx = await SignalsPage({ searchParams: Promise.resolve({ page: '6' }) })
    assert.ok(jsx)
  })
})
