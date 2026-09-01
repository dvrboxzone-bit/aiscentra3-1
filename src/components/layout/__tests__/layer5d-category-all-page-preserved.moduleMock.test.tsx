import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/signals — category=ALL redirect preserves the real page param', () => {
  test('category=ALL with page=3 preserves the real page param through the redirect (/signals?page=3, not /signals?category=ALL&page=3)', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => {
          throw new Error('must not be called')
        },
        getSignalsCount: async () => {
          throw new Error('must not be called')
        },
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/(public)/signals/page')

    await assert.rejects(
      () => SignalsPage({ searchParams: Promise.resolve({ category: 'ALL', page: '3' }) }),
      (err: unknown) => {
        const digest = (err as { digest?: string }).digest ?? ''
        assert.match(
          digest,
          /;\/signals\?page=3;/,
          'the real page param must be preserved through the redirect, category dropped',
        )
        return true
      },
    )
  })
})
