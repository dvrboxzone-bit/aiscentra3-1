import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/search — real 2-char minimum-length gate (does NOT call search)', () => {
  test('the real /search page does NOT call the real search() when q is shorter than 2 characters, and shows the real "Enter at least 2 characters" message', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let searchCallCount = 0
    mock.module('@/modules/search/queries', {
      namedExports: {
        search: async () => {
          searchCallCount++
          return { signals: [], events: [], reports: [], total: 0, query: '' }
        },
      },
    })
    const { default: SearchPage } = await import('../../../app/(public)/search/page')
    const jsx = await SearchPage({ searchParams: Promise.resolve({ q: 'a' }) })
    const { container } = render(jsx)
    assert.equal(searchCallCount, 0, 'the real search() must NOT be called for a 1-character query')
    assert.match(container.innerHTML, /Enter at least 2 characters to search\./)
  })
})
