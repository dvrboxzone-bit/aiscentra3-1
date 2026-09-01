import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/signals — an unknown category returns real notFound()', () => {
  test('an unknown, non-"ALL" category string calls the real Next.js notFound() -- never silently falls back to the ALL catalog', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => {
          throw new Error('getSignals must not be called for an invalid category')
        },
        getSignalsCount: async () => {
          throw new Error('getSignalsCount must not be called for an invalid category')
        },
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/(public)/signals/page')

    await assert.rejects(
      () => SignalsPage({ searchParams: Promise.resolve({ category: 'NOT_A_REAL_CATEGORY' }) }),
      (err: unknown) => {
        const digest = (err as { digest?: string }).digest ?? ''
        assert.match(digest, /404/, 'the real Next.js notFound() error digest must contain 404')
        return true
      },
    )
  })
})
