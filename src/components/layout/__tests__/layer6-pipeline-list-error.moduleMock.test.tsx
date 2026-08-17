import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

function makeBuilder(result: {
  data?: unknown[] | null
  count?: number | null
  error: unknown
}): unknown {
  const builder = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    is: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => Promise.resolve(result),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  }
  return builder
}

describe('/admin/pipeline — a real "recent observations" query failure shows an honest error, never a fabricated empty list', () => {
  test('when the real recentObs query fails, the page shows "RECENT OBSERVATIONS UNAVAILABLE" -- distinct from the real, honest "genuinely found no recent observations" empty state', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let callIndex = 0
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () => ({
          from: () => {
            callIndex++
            // 7th real call in the page's own Promise.all is recentObs.
            if (callIndex === 7) {
              return makeBuilder({ data: null, error: { message: 'connection reset' } })
            }
            if (callIndex === 8 || callIndex === 9) {
              return makeBuilder({ data: [], error: null })
            }
            return makeBuilder({ count: 0, error: null })
          },
        }),
      },
    })
    const { default: AdminPipelinePage } = await import(
      '../../../app/admin/(protected)/pipeline/page'
    )
    const jsx = await AdminPipelinePage()
    const { container } = render(jsx)

    assert.match(
      container.innerHTML,
      /RECENT OBSERVATIONS UNAVAILABLE/,
      'a genuine recentObs query failure must show its own distinct, honest error message',
    )
    assert.doesNotMatch(
      container.innerHTML,
      /genuinely found no recent observations/,
      'a real query FAILURE must never be shown as the real, honest empty-state wording -- those are different real states',
    )
  })
})
