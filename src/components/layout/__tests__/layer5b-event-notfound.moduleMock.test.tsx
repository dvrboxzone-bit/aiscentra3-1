import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/events/[slug] — real notFound() behavior', () => {
  test('the real /events/[slug] page calls the real Next.js notFound() when the real getEventById returns null', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/events/queries', {
      namedExports: { getEventById: async () => null },
    })
    mock.module('@/modules/signals/queries', {
      namedExports: { getSignalById: async () => null },
    })
    const { default: EventPage } = await import('../../../app/events/[slug]/page')
    await assert.rejects(
      () => EventPage({ params: Promise.resolve({ slug: 'missing-event' }) }),
      (err: unknown) => {
        const digest = (err as { digest?: string }).digest ?? ''
        assert.match(digest, /404/, 'the real Next.js notFound() error digest must contain 404')
        return true
      },
    )
  })
})
