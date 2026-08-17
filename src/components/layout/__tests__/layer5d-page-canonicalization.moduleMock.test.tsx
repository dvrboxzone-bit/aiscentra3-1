import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5b-fixtures'

describe('/signals — invalid, fractional, or <1 page values are canonicalized to page 1', () => {
  test('page="abc" (non-numeric), page="1.5" (fractional), and page="-3" (negative) all genuinely request real page 1 from getSignals(), not a crash or a false page number', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const signals = Array.from({ length: 25 }, (_, i) => makeSignal({ id: `s-${i}` }))
    const capturedPages: unknown[] = []
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async (filters: { page?: number }) => {
          capturedPages.push(filters.page)
          return signals
        },
        getSignalsCount: async () => 100,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')

    for (const rawPage of ['abc', '1.5', '-3']) {
      const jsx = await SignalsPage({ searchParams: Promise.resolve({ page: rawPage }) })
      render(jsx)
    }

    assert.deepEqual(
      capturedPages,
      [1, 1, 1],
      'every invalid page value ("abc", "1.5", "-3") must genuinely canonicalize to real page 1',
    )
  })
})
