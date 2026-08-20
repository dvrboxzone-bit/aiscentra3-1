import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin/pipeline — real absence of errors hides the section entirely', () => {
  test('a real result with zero processing errors does NOT render the PROCESSING ERRORS section at all', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () => ({
          from: () => {
            const builder = {
              select: () => builder,
              eq: () => builder,
              not: () => builder,
              is: () => builder,
              gte: () => builder,
              order: () => builder,
              limit: () => Promise.resolve({ data: [] }),
              then: (resolve: (v: { count: number }) => void) => resolve({ count: 0 }),
            }
            return builder
          },
        }),
      },
    })
    const { default: AdminPipelinePage } = await import(
      '../../../app/admin/(protected)/pipeline/page'
    )
    const jsx = await AdminPipelinePage()
    const { container } = render(jsx)
    // "PROCESSING ERRORS" text alone is ambiguous -- it ALSO appears as
    // the always-present 24h metric label ("Processing Errors": 0).
    // The real, conditional error-LIST section is specifically styled
    // with the amber border classes -- absence of that container is
    // the genuine assertion.
    assert.equal(
      container.querySelectorAll('.divide-amber-400\\/20').length,
      0,
      'the real conditional processing-error list container must not render when there are zero real errors',
    )
  })
})
