import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('FINALIZE redelivery retries only finalization and never invokes a provider', async (t) => {
  let providerCalls = 0
  let finalizeCalls = 0
  let fromCalls = 0

  const aiMock = mock.module('@/lib/ai/client', {
    namedExports: {
      callProviderJSON: async () => {
        providerCalls += 1
        throw new Error('provider must not run for FINALIZE delivery')
      },
      estimateRequestTokens: () => 1,
      AIInvalidResponseEnvelopeError: class extends Error {},
      AIProviderError: class extends Error {},
    },
  })
  const lockMock = mock.module('@/lib/ai/execution-lock', {
    namedExports: {
      acquireEnrichmentLock: async () => true,
      releaseEnrichmentLock: async () => true,
    },
  })
  const guardMock = mock.module('@/lib/security/cron-guard', {
    namedExports: { isAuthorizedCronRequest: () => true },
  })

  const finalizationClaim = {
    message_id: 91,
    attempt_id: null,
    run_id: '11111111-1111-1111-1111-111111111111',
    observation_id: 'e4275483-39e4-4441-84a2-0a1df546cf07',
    stage: 'FINALIZE',
    ordinal: null,
    provider: null,
    model: null,
    redelivered: false,
  }
  const db = {
    rpc: async (name: string) => {
      if (name === 'claim_durable_sis_v1_attempt') {
        return { data: [finalizationClaim], error: null }
      }
      if (name === 'finalize_durable_sis_v1') {
        finalizeCalls += 1
        if (finalizeCalls === 1) {
          return { data: null, error: { message: 'temporary database failure' } }
        }
        return { data: { outcome: 'DISCARD', duplicate: false }, error: null }
      }
      throw new Error(`unexpected RPC: ${name}`)
    },
    from: () => {
      fromCalls += 1
      throw new Error('FINALIZE delivery must not load provider inputs')
    },
  }
  const supabaseMock = mock.module('@/lib/supabase/server', {
    namedExports: { createAdminClient: () => db },
  })
  t.after(() => {
    supabaseMock.restore()
    guardMock.restore()
    lockMock.restore()
    aiMock.restore()
  })

  const { POST } = await import('../route')
  const request = new Request('https://aiscentra.test/api/internal/sis-durable-control/stage', {
    method: 'POST',
  })

  const first = await POST(request)
  assert.equal(first.status, 503)
  assert.equal((await first.json()).status, 'FINALIZE_RETRY')

  const second = await POST(request)
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), {
    attempted: 0,
    status: 'FINALIZED',
    outcome: 'DISCARD',
    duplicate: false,
  })
  assert.equal(finalizeCalls, 2)
  assert.equal(providerCalls, 0)
  assert.equal(fromCalls, 0)
})
