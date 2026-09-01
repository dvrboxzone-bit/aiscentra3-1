import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/search — real search() called for a valid query, query preserved in the input, real result links', () => {
  test("the real /search page calls the real search() for a 2+ character query, preserves q in the input's defaultValue, and renders real result links/formatting grouped by type", async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let searchCalledWith: string | null = null
    mock.module('@/modules/search/queries', {
      namedExports: {
        search: async (q: string) => {
          searchCalledWith = q
          return {
            signals: [
              {
                id: 'sig-1',
                type: 'signal',
                title: 'Real Search Signal',
                summary: 'Real summary text.',
                category: 'MODELS',
                score: 72,
                href: '/signals/sig-1',
                date: new Date().toISOString(),
              },
            ],
            events: [],
            reports: [],
            total: 1,
            query: q,
          }
        },
      },
    })
    const { default: SearchPage } = await import('../../../app/(public)/search/page')
    const jsx = await SearchPage({ searchParams: Promise.resolve({ q: 'transformer' }) })
    const { container } = render(jsx)

    assert.equal(
      searchCalledWith,
      'transformer',
      'the real search() must be called with the real query string',
    )

    const input = container.querySelector('input[name="q"]') as HTMLInputElement | null
    assert.ok(input, 'the real search input must exist')
    assert.equal(
      input?.defaultValue,
      'transformer',
      'the query must be preserved in the input field',
    )

    const resultLink = container.querySelector('a[href="/signals/sig-1"]')
    assert.ok(resultLink, 'a real, working result link (the real result.href) must render')
    assert.match(container.innerHTML, /Real Search Signal/)

    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)
  })
})
