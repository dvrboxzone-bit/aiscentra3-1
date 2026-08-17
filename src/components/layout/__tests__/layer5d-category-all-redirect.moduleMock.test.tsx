import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/signals — category=ALL is genuinely redirected to the canonical /signals URL', () => {
  test('category=ALL calls the real Next.js redirect() to the bare /signals URL -- a genuine 3xx redirect, not a silently-duplicate URL serving identical content', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => {
          throw new Error('getSignals must not be called when category=ALL redirects')
        },
        getSignalsCount: async () => {
          throw new Error('getSignalsCount must not be called when category=ALL redirects')
        },
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')

    await assert.rejects(
      () => SignalsPage({ searchParams: Promise.resolve({ category: 'ALL' }) }),
      (err: unknown) => {
        const digest = (err as { digest?: string }).digest ?? ''
        assert.match(
          digest,
          /^NEXT_REDIRECT;/,
          'the real Next.js redirect() error digest must exist',
        )
        assert.match(
          digest,
          /;\/signals;/,
          'the real redirect target must be the bare, canonical /signals URL',
        )
        return true
      },
    )
  })
})
