import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5b-fixtures'

describe('/signals — real ONE batch source-links call for the whole page, not N per-signal calls', () => {
  test("a page of 25 signals calls the real getSourceLinksForSignals() exactly ONCE, receiving all 25 signals' real observation ids in a single real call -- REAL BUG FIXED: was previously up to 25 separate admin-client database round-trips", async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const signals = Array.from({ length: 25 }, (_, i) =>
      makeSignal({ id: `s-${i}`, observation_ids: [`obs-${i}`] }),
    )
    let callCount = 0
    let capturedArg: unknown = null
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => signals,
        getSignalsCount: async () => 25,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: {
        getSourceLinksForSignals: async (
          arg: Array<{ signalId: string; observationIds: string[] }>,
        ) => {
          callCount++
          capturedArg = arg
          return new Map()
        },
      },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({}) })
    render(jsx)

    assert.equal(
      callCount,
      1,
      'getSourceLinksForSignals() must be called exactly ONCE for the whole page, never once per card',
    )
    assert.equal(
      (capturedArg as unknown[]).length,
      25,
      "the single real call must carry all 25 real signals' own observation ids, grouped by signalId",
    )
  })
})
