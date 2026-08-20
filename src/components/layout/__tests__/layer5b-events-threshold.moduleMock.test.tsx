import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/events — real promotion-threshold copy on empty state', () => {
  test('the real /events page shows the real promotion-threshold explanation text when the real query returns zero events', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/events/queries', {
      namedExports: { getEvents: async () => [] },
    })
    const { default: EventsPage } = await import('../../../app/events/page')
    const jsx = await EventsPage()
    const { container } = render(jsx)
    assert.match(
      container.innerHTML,
      /score ≥ 70, confidence ≥ 65/,
      'the real, exact promotion-threshold explanation copy must render on empty state',
    )
  })
})
