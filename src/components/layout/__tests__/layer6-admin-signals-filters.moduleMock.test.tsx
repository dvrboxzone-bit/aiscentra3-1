import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

function makeFakeAdminClient(signalRows: unknown[], totalCount: number): unknown {
  return {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: () => Promise.resolve({ data: signalRows, count: totalCount }),
        then: (resolve: (v: { count: number }) => void) => resolve({ count: totalCount }),
      }
      return builder
    },
  }
}

describe('/admin/signals — real status filter and pagination preserve real query params', () => {
  test('the real AdminSignalsPage reaches the real query with the real status filter, and its own real Prev/Next links carry BOTH status and page forward', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `sig-${i}`,
      signal_score: 70,
      confidence_score: 60,
      category: 'MODELS',
      title: `Signal ${i}`,
      created_at: new Date().toISOString(),
      validation_flags: [],
    }))
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () => makeFakeAdminClient(rows, 60),
      },
    })
    const { default: AdminSignalsPage } = await import(
      '../../../app/admin/(protected)/signals/page'
    )
    const jsx = await AdminSignalsPage({
      searchParams: Promise.resolve({ status: 'WEAK', page: '2' }),
    })
    const { container } = render(jsx)

    assert.ok(
      container.querySelector('a[href="/admin/signals?status=WEAK&page=1"]'),
      'the real Prev link must carry both the real status and the real previous page',
    )
    assert.ok(
      container.querySelector('a[href="/admin/signals?status=WEAK&page=3"]'),
      'the real Next link must carry both the real status and the real next page',
    )
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
  })
})
