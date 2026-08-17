import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/signals — category=ALL is genuinely rejected', () => {
  test('category=ALL in the real URL is treated as the real ALL catalog (no category filter), never queried as a literal, non-existent category value', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let capturedFilters: unknown = null
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async (filters: unknown) => {
          capturedFilters = filters
          return []
        },
        getSignalsCount: async () => 0,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignal: async () => [] },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({ category: 'ALL' }) })
    render(jsx)

    assert.deepEqual(
      capturedFilters,
      { page: 1, pageSize: 25 },
      'category=ALL must never appear as a real category filter passed to getSignals() -- it must be ignored, resolving to the real, unfiltered ALL catalog',
    )
  })
})
