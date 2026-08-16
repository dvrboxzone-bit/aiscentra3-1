import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeEvent } from './layer5b-fixtures'

describe('/events — real query preserved, VfinalPublicShell, no forbidden URLs', () => {
  test('the real /events page renders real events with shared header/footer and real /events/[id] links', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const events = [
      makeEvent({ id: 'e1', title: 'Real Event One' }),
      makeEvent({ id: 'e2', title: 'Real Event Two' }),
    ]
    mock.module('@/modules/events/queries', {
      namedExports: { getEvents: async () => events },
    })
    const { default: EventsPage } = await import('../../../app/events/page')
    const jsx = await EventsPage()
    const { container } = render(jsx)
    assert.match(container.innerHTML, /Real Event One/)
    assert.match(container.innerHTML, /Real Event Two/)
    assert.ok(container.querySelector('a[href="/events/e1"]'))
    assert.ok(container.querySelector('header#header'))
    assert.ok(container.querySelector('footer#footer'))
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)
  })
})
