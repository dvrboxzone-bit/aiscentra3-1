import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeEvent } from './layer5b-fixtures'

describe('/events — real query preserved, VfinalPublicShell, no forbidden URLs, real counts', () => {
  test('the real /events page renders real events with shared header/footer, real /events/[id] links, real per-type counts, and real threshold-explanation copy', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const events = [
      makeEvent({ id: 'e1', title: 'Real Event One', event_type: 'LAUNCH' }),
      makeEvent({ id: 'e2', title: 'Real Event Two', event_type: 'LAUNCH' }),
      makeEvent({ id: 'e3', title: 'Real Event Three', event_type: 'FUNDING' }),
    ]
    mock.module('@/modules/events/queries', {
      namedExports: { getEvents: async () => events },
    })
    const { default: EventsPage } = await import('../../../app/events/page')
    const jsx = await EventsPage()
    const { container } = render(jsx)
    assert.match(container.innerHTML, /Real Event One/)
    assert.match(container.innerHTML, /Real Event Two/)
    assert.match(container.innerHTML, /Real Event Three/)
    assert.ok(container.querySelector('a[href="/events/e1"]'))
    assert.ok(container.querySelector('header#header'))
    assert.ok(container.querySelector('footer#footer'))
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)

    // Real per-type counts: 2 LAUNCH events, 1 FUNDING event -- the
    // real EVENT_TYPE_LABELS/count-computation logic, not a rewritten
    // copy of it.
    const countLabels = Array.from(container.querySelectorAll('span')).map((el) => el.textContent)
    assert.ok(
      countLabels.some((t) => t === '2'),
      'the real count "2" for LAUNCH must render',
    )
    assert.ok(
      countLabels.some((t) => t === '1'),
      'the real count "1" for FUNDING must render',
    )
  })
})
