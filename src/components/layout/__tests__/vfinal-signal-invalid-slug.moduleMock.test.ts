import { describe, mock, test } from 'node:test'
import assert from 'node:assert/strict'

describe('/signals/[slug] malformed slug boundary', () => {
  test('returns not-found before any Supabase-bound query is called', async (t) => {
    let signalCalls = 0
    let eventCalls = 0
    let evidenceCalls = 0
    let entityCalls = 0

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
        getSignalsByEntity: async () => [],
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
        getEvidenceForSignal: async () => {
          evidenceCalls += 1
          return []
        },
      },
    })
    const entitiesMock = mock.module('@/modules/entities/queries', {
      namedExports: {
        getEntityById: async () => {
          entityCalls += 1
          return null
        },
      },
    })
    t.after(() => {
      navigationMock.restore()
      signalsMock.restore()
      eventsMock.restore()
      observationsMock.restore()
      entitiesMock.restore()
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
    assert.equal(evidenceCalls, 0)
    assert.equal(entityCalls, 0)
  })
})
