import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/signals — a page genuinely beyond the real total returns real notFound()', () => {
  test('page=999 with a real total of only 6 pages (150 signals / 25 per page) calls the real Next.js notFound() -- never a false "page 999 of 6" state', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => [],
        getSignalsCount: async () => 150,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/(public)/signals/page')

    await assert.rejects(
      () => SignalsPage({ searchParams: Promise.resolve({ page: '999' }) }),
      (err: unknown) => {
        const digest = (err as { digest?: string }).digest ?? ''
        assert.match(
          digest,
          /404/,
          'a page beyond the real total must return the real Next.js notFound(), not a rendered false state',
        )
        return true
      },
    )
  })
})
