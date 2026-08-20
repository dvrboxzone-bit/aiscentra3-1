import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/signals — real, honest empty-state for a category with zero real signals', () => {
  test('a category with zero real signals shows the real, honest empty-state message -- not fabricated placeholder cards', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => [],
        getSignalsCount: async () => 0,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignals: async () => new Map() },
    })
    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({ category: 'HARDWARE' }) })
    const { container } = render(jsx)
    assert.match(container.innerHTML, /No signals detected in HARDWARE yet\./)
    assert.equal(container.querySelectorAll('[data-content-slot="signal"]').length, 0)
  })
})
