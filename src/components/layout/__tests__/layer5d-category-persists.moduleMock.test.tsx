import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5b-fixtures'

describe('/signals — category is preserved across all pagination navigation', () => {
  test('on a category page, Previous/Next and every page-number link carry the real category param forward, never dropping it', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let capturedFilters: unknown = null
    const pageSignals = Array.from({ length: 25 }, (_, i) =>
      makeSignal({ id: `infra-${i}`, category: 'INFRASTRUCTURE' }),
    )
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async (filters: unknown) => {
          capturedFilters = filters
          return pageSignals
        },
        getSignalsCount: async () => 60, // 3 real pages
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignal: async () => [] },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({
      searchParams: Promise.resolve({ category: 'INFRASTRUCTURE', page: '2' }),
    })
    const { container } = render(jsx)

    assert.deepEqual(
      capturedFilters,
      { category: 'INFRASTRUCTURE', page: 2, pageSize: 25 },
      'the real getSignals() must receive the real category alongside real page/pageSize',
    )

    assert.ok(
      container.querySelector('a[href="/signals?category=INFRASTRUCTURE"]'),
      'Previous (page 1) must carry the real category forward',
    )
    assert.ok(
      container.querySelector('a[href="/signals?category=INFRASTRUCTURE&page=3"]'),
      'the real "Show next 25" link must carry the real category forward to page 3',
    )
  })
})
