import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin/sources — real query failure shows honest error, never fabricated zero', () => {
  test('when the real query returns a genuine error, the page shows a distinct error banner ("SOURCE QUERY FAILED") -- never "0 registered sources"', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              order: () =>
                Promise.resolve({
                  data: null,
                  error: { message: 'connection refused' },
                }),
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
      /SOURCE QUERY FAILED/,
      'a real query failure must show a distinct, honest error banner',
    )
    assert.doesNotMatch(
      container.innerHTML,
      /0 registered source/,
      'a genuine query failure must NEVER render as "0 registered sources" -- that is a fabricated success claim',
    )
  })
})
