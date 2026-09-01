import { describe, mock, test } from 'node:test'
import assert from 'node:assert/strict'

describe('/signals/[slug] malformed slug boundary', () => {
  test('returns not-found before any Supabase-bound query is called', async (t) => {
    let signalCalls = 0
    let eventCalls = 0
    let sourceCalls = 0

    const navigationMock = mock.module('next/navigation', {
      namedExports: {
        notFound: () => {
          throw new Error('NEXT_NOT_FOUND')
        },
      },
    })
    const signalsMock = mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignalById: async () => {
          signalCalls += 1
          return null
        },
      },
    })
    const eventsMock = mock.module('@/modules/events/queries', {
      namedExports: {
        getEventsBySignal: async () => {
          eventCalls += 1
          return []
        },
      },
    })
    const observationsMock = mock.module('@/modules/observations/queries', {
      namedExports: {
        getSourceLinksForSignal: async () => {
          sourceCalls += 1
          return []
        },
      },
    })
    t.after(() => {
      navigationMock.restore()
      signalsMock.restore()
      eventsMock.restore()
      observationsMock.restore()
    })

    const { default: SignalPage } = await import(
      `../../../app/(public)/signals/[slug]/page?invalid=${Date.now()}`
    )

    await assert.rejects(
      () => SignalPage({ params: Promise.resolve({ slug: 'not-a-uuid' }) }),
      /NEXT_NOT_FOUND/,
    )
    assert.equal(signalCalls, 0)
    assert.equal(eventCalls, 0)
    assert.equal(sourceCalls, 0)
  })
})
