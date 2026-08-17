import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

function makeFakePipelineClient(overrides: Partial<Record<string, unknown[]>> = {}): unknown {
  return {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        is: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: overrides[table] ?? [] }),
        then: (resolve: (v: { count: number }) => void) =>
          resolve({ count: (overrides[table] ?? []).length }),
      }
      return builder
    },
  }
}

describe('/admin/pipeline — real processing errors rendered', () => {
  test('the real AdminPipelinePage reaches the real createAdminClient() and renders the real processing-error text (not truncated data, not a fabricated message)', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () =>
          makeFakePipelineClient({
            observations: [
              {
                id: 'err-1',
                title: 'Real Failing Observation',
                processing_error: 'Real error: rate limit exceeded on model chain',
                collected_at: new Date().toISOString(),
              },
            ],
          }),
      },
    })
    const { default: AdminPipelinePage } = await import(
      '../../../app/admin/(protected)/pipeline/page'
    )
    const jsx = await AdminPipelinePage()
    const { container } = render(jsx)

    assert.match(container.innerHTML, /Pipeline Status/)
    assert.match(container.innerHTML, /PROCESSING ERRORS/)
    assert.match(container.innerHTML, /Real Failing Observation/)
    assert.match(container.innerHTML, /Real error: rate limit exceeded/)
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
  })
})
