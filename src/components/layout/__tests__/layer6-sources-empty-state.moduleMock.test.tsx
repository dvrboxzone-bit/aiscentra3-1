import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin/sources — real successful empty result is visually and textually distinct from a query failure', () => {
  test('a real successful query returning zero rows (error: null, data: []) shows the explicit "NO SOURCES REGISTERED" empty state, not the error banner', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      },
    })
    const { default: AdminSourcesPage } = await import(
      '../../../app/admin/(protected)/sources/page'
    )
    const jsx = await AdminSourcesPage()
    const { container } = render(jsx)

    assert.match(
      container.innerHTML,
      /NO SOURCES REGISTERED/,
      'a genuine successful-but-empty result must show its own distinct empty-state message',
    )
    assert.doesNotMatch(
      container.innerHTML,
      /SOURCE QUERY FAILED/,
      'a genuine success (error: null) must never show the failure banner',
    )
    assert.match(
      container.innerHTML,
      /0 registered source/,
      'the real, honest zero count must still render in the header for a genuine success',
    )
  })
})
