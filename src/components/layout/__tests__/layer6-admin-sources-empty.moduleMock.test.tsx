import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin/sources — real empty state, no fabricated fallback', () => {
  test('a real empty result (zero sources) shows "0 registered sources", not a fabricated fallback', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              order: () => Promise.resolve({ data: [] }),
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
    assert.match(container.innerHTML, /0 registered sources/)
  })
})
