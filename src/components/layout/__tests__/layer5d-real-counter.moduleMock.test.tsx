import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5b-fixtures'

describe('/signals — real counter reflects the real total published count, not the rendered-page count', () => {
  test('the real page shows the real getSignalsCount() total (e.g. 137), genuinely distinct from the 25 cards rendered on the current page -- never a fabricated or telemetry-style number', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const pageSignals = Array.from({ length: 25 }, (_, i) => makeSignal({ id: `s-${i}` }))
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => pageSignals,
        getSignalsCount: async () => 137,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({}) })
    const { container } = render(jsx)

    assert.match(
      container.innerHTML,
      /137 published signal/,
      'the real total count (137) must render verbatim, distinct from the 25 rendered cards',
    )
    assert.equal(container.querySelectorAll('[data-content-slot="signal"]').length, 25)
  })
})
