import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5b-fixtures'

describe('/signals — real pagination: 25 per page, Previous/Next, page numbers', () => {
  test('the real /signals page requests page 2 with pageSize 25 from the real getSignals(), and renders Previous + page-number links + a real "Show next 25" link (not infinite scroll)', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let capturedFilters: unknown = null
    const pageSignals = Array.from({ length: 25 }, (_, i) => makeSignal({ id: `p2-${i}` }))
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async (filters: unknown) => {
          capturedFilters = filters
          return pageSignals
        },
        getSignalsCount: async () => 70, // 3 real pages at 25/page
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({ page: '2' }) })
    const { container } = render(jsx)

    assert.deepEqual(
      capturedFilters,
      { page: 2, pageSize: 25 },
      'the real getSignals() must be called with real page/pageSize params, not a client-side slice',
    )

    assert.ok(
      container.querySelector('a[href="/signals"]'),
      'Previous must link to the real page 1 URL (no page param needed for page 1)',
    )
    assert.ok(
      container.querySelector('a[href="/signals?page=3"]'),
      'the real "Show next 25" link must navigate to page 3',
    )
    assert.match(container.innerHTML, /Show next 25/)

    const currentPageLink = container.querySelector('a[aria-current="page"]')
    assert.equal(currentPageLink?.textContent?.trim(), '2')

    assert.equal(
      container.querySelectorAll('[data-content-slot="signal"]').length,
      25,
      'exactly 25 cards must render, never collapsed to a 6-card featured subset',
    )
  })
})
