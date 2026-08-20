import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5a-fixtures'

describe('/signals/[slug] — real detail-page functions preserved', () => {
  test('the real /signals/[slug] page renders real signal data with VfinalPublicShell, no forbidden URLs', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const signal = makeSignal({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Real Detail Signal',
    })
    mock.module('@/modules/signals/queries', {
      namedExports: { getSignalById: async () => signal },
    })
    mock.module('@/modules/events/queries', {
      namedExports: { getEventsBySignal: async () => [] },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: { getSourceLinksForSignal: async () => [] },
    })
    const { default: SignalPage } = await import('../../../app/signals/[slug]/page')
    const jsx = await SignalPage({
      params: Promise.resolve({ slug: '11111111-1111-4111-8111-111111111111' }),
    })
    const { container } = render(jsx)
    assert.match(container.innerHTML, /Real Detail Signal/)
    assert.ok(container.querySelector('header#header'))
    assert.ok(container.querySelector('footer#footer'))
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)
  })
})
