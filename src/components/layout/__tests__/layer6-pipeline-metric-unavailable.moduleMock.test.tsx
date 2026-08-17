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

describe('/admin/pipeline — a real, individual query failure shows UNAVAILABLE, never a fabricated zero', () => {
  test('when the real "unprocessed" count query fails, its own metric card shows "UNAVAILABLE" (not "0"), while other, successful metrics still render their own real values', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let callIndex = 0
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () => ({
          from: () => {
            callIndex++
            // The real page's own Promise.all order: totalObs(1),
            // unprocessed(2), withErrors(3), obs24h(4), sigs24h(5),
            // events24h(6), recentObs(7), recentErrors(8),
            // pendingRetryRows(9). Only the 2nd real call
            // (unprocessed) genuinely fails here.
            if (callIndex === 2) {
              return makeBuilder({ count: null, error: { message: 'timeout' } })
            }
            if (callIndex === 7 || callIndex === 8 || callIndex === 9) {
              return makeBuilder({ data: [], error: null })
            }
            return makeBuilder({ count: 5, error: null })
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
      /UNAVAILABLE/,
      'the real, individually-failed "Unprocessed Queue" metric must show UNAVAILABLE, never a fabricated 0',
    )
    // The real other, successfully-resolved metrics (count: 5) must
    // still render their own genuine values -- one failure does not
    // blank out the whole dashboard.
    assert.match(
      container.innerHTML,
      />5</,
      'other, genuinely successful metrics must still render their real values',
    )
  })
})
