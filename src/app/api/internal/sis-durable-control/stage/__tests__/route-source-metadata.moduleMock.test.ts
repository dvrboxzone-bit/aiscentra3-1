import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('real source type and trust score reach Durable SIS stage payloads without fallback', async (t) => {
  const sourceSelects: string[] = []
  const reservations: Array<{ content: string; model: string }> = []
  const claims = [
    {
      message_id: 101,
      attempt_id: '11111111-1111-1111-1111-111111111111',
      run_id: '22222222-2222-2222-2222-222222222222',
      observation_id: 'e4275483-39e4-4441-84a2-0a1df546cf07',
      stage: 'CLASSIFIER',
      ordinal: 1,
      provider: 'groq',
      model: 'classifier-primary',
      redelivered: true,
    },
    {
      message_id: 102,
      attempt_id: '33333333-3333-3333-3333-333333333333',
      run_id: '22222222-2222-2222-2222-222222222222',
      observation_id: 'e4275483-39e4-4441-84a2-0a1df546cf07',
      stage: 'PARSER',
      ordinal: 1,
      provider: 'groq',
      model: 'parser-primary',
      redelivered: true,
    },
  ]

  const aiMock = mock.module('@/lib/ai/client', {
    namedExports: {
      callProviderJSON: async () => {
        throw new Error('redelivery must not invoke a provider')
      },
      estimateRequestTokens: (messages: Array<{ content: string }>) => {
        reservations.push({ content: messages[1]?.content ?? '', model: 'classifier-fallback' })
        return 1
      },
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
  const modelsMock = mock.module('@/lib/ai/models', {
    namedExports: {
      getModelChain: (stage: 'classifier' | 'parser') => [
        { provider: 'groq', model: `${stage}-primary` },
        { provider: 'groq', model: `${stage}-fallback` },
      ],
    },
  })
  const guardMock = mock.module('@/lib/security/cron-guard', {
    namedExports: { isAuthorizedCronRequest: () => true },
  })

  const observation = {
    id: 'e4275483-39e4-4441-84a2-0a1df546cf07',
    source_id: '44444444-4444-4444-4444-444444444444',
    title: 'Control observation',
    content: 'Verified primary evidence',
    url: 'https://source.example/evidence',
  }
  const source = { name: 'Verified Source', type: 'primary', trust_score: 0.91 }
  const db = {
    rpc: async (name: string) => {
      if (name === 'claim_durable_sis_v1_attempt') {
        return { data: [claims.shift()], error: null }
      }
      if (name === 'complete_durable_sis_v1_attempt') {
        return { data: { status: 'QUEUED' }, error: null }
      }
      throw new Error(`unexpected RPC: ${name}`)
    },
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === 'sources') sourceSelects.push(columns)
        return {
          eq: () => ({
            single: async () => ({
              data: table === 'observations' ? observation : source,
              error: null,
            }),
          }),
        }
      },
    }),
  }
  const supabaseMock = mock.module('@/lib/supabase/server', {
    namedExports: { createAdminClient: () => db },
  })
  t.after(() => {
    supabaseMock.restore()
    guardMock.restore()
    modelsMock.restore()
    lockMock.restore()
    aiMock.restore()
  })

  const { POST } = await import('../route')
  const request = new Request('https://aiscentra.test/api/internal/sis-durable-control/stage', {
    method: 'POST',
  })

  assert.equal((await POST(request)).status, 200)
  assert.equal((await POST(request)).status, 200)
  assert.deepEqual(sourceSelects, ['name, type, trust_score', 'name, type, trust_score'])

  const classifierPayload = reservations[0]?.content ?? ''
  const parserPayload = reservations[1]?.content ?? ''
  assert.match(classifierPayload, /SOURCE: Verified Source \(primary\)/)
  assert.match(parserPayload, /SOURCE: Verified Source \| trust=0\.91 \|/)
  assert.doesNotMatch(classifierPayload, /Unknown Source/)
  assert.doesNotMatch(parserPayload, /Unknown Source|trust=0\.5/)
})
