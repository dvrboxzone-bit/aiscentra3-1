import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5a-fixtures'

describe('/signals — critical release-gate contract intact', () => {
  test('the real /signals page preserves data-active-signal-count on the same element, using the real signals.length', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const signals = [makeSignal({ id: 's1' }), makeSignal({ id: 's2' })]
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => signals,
        getSignalsCount: async () => signals.length,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/(public)/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({}) })
    const { container } = render(jsx)
    const el = container.querySelector('[data-active-signal-count]')
    assert.ok(
      el,
      'data-active-signal-count must exist -- this is a real, production release-gate contract',
    )
    assert.equal(el?.getAttribute('data-active-signal-count'), '2')
  })
})
