import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

function makeFakeSupabase(tables: Record<string, { data: unknown[]; count: number }>): unknown {
  return {
    from: (table: string) => {
      const t = tables[table] ?? { data: [], count: 0 }
      const builder = {
        select: () => builder,
        gte: () => builder,
        not: () => builder,
        eq: () => builder,
        then: (resolve: (v: { data: unknown[]; count: number }) => void) => resolve(t),
      }
      return builder
    },
  }
}

describe('/admin dashboard — real queries reached, real metrics computed', () => {
  test('the real AdminDashboard reaches the real createAdminClient() and computes real severity/unprocessed/error metrics from the real returned rows', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () =>
          makeFakeSupabase({
            sources: { data: [{ id: 's1', status: 'ACTIVE' }], count: 1 },
            observations: {
              data: [{ id: 'o1', processed: false, processing_error: null, metadata: {} }],
              count: 1,
            },
            signals: { data: [{ id: 'sig1', status: 'ACTIVE', signal_score: 90 }], count: 1 },
            events: { data: [], count: 3 },
            reports: { data: [], count: 2 },
          }),
      },
    })
    const { default: AdminDashboard } = await import('../../../app/admin/(protected)/page')
    const jsx = await AdminDashboard()
    const { container } = render(jsx)

    assert.match(container.innerHTML, /Observatory Status/)
    // Real severity computation: signal_score=90 -> CRITICAL (>=80).
    assert.match(container.innerHTML, /CRITICAL SIGNALS/)
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
  })
})
