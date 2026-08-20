import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeEvent, makeSignal } from './layer5b-fixtures'

describe('/events/[slug] — real detail-page functions preserved', () => {
  test('the real /events/[slug] page renders real event and origin-signal data with shared header/footer, no forbidden URLs', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const event = makeEvent({ id: 'e1', title: 'Real Event Detail', signal_id: 'origin-sig' })
    const originSignal = makeSignal({ id: 'origin-sig', title: 'Real Origin Signal' })
    mock.module('@/modules/events/queries', {
      namedExports: { getEventById: async () => event },
    })
    mock.module('@/modules/signals/queries', {
      namedExports: { getSignalById: async () => originSignal },
    })
    const { default: EventPage } = await import('../../../app/events/[slug]/page')
    const jsx = await EventPage({ params: Promise.resolve({ slug: 'e1' }) })
    const { container } = render(jsx)
    assert.match(container.innerHTML, /Real Event Detail/)
    assert.match(container.innerHTML, /Real Origin Signal/)
    assert.ok(container.querySelector('a[href="/signals/origin-sig"]'))
    assert.ok(container.querySelector('header#header'))
    assert.ok(container.querySelector('footer#footer'))
    assert.doesNotMatch(container.innerHTML, /href="#"/)
  })
})
