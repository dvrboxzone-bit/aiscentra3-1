import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('score below 2 DISCARD finalizes R-09 without parser or Signal', async (t) => {
  let providerCalls = 0
  const completions: Array<Record<string, unknown>> = []
  const classifierOutput = {
    sis_novelty: 2,
    sis_importance: 2,
    sis_urgency: 2,
    sis_confidence: 2,
    human_cto: false,
    human_research_director: false,
    human_vc: false,
    human_founder: false,
    human_government_analyst: false,
    human_enterprise_architect: false,
    anti_hype_score: 8,
    anti_hype_flags: [],
    relevance_horizon: 'MONTHS',
    event_type: 'DISCRETE_EVENT',
    engine_justification:
      'The material is credible but describes routine technical work. It does not change decisions or the broader ecosystem.',
  }

  const aiMock = mock.module('@/lib/ai/client', {
    namedExports: {
      callProviderJSON: async () => {
        providerCalls += 1
        return classifierOutput
      },
      estimateRequestTokens: () => 100,
      AIInvalidResponseEnvelopeError: class extends Error {},
      AIProviderError: class extends Error {},
      MAX_PROVIDER_ERROR_MESSAGE_LENGTH: 300,
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
      getModelChain: () => {
        throw new Error('DISCARD must not resolve a parser chain')
      },
    },
  })
  const guardMock = mock.module('@/lib/security/cron-guard', {
    namedExports: { isAuthorizedCronRequest: () => true },
  })
  const claim = {
    message_id: 301,
    attempt_id: '11111111-1111-4111-8111-111111111111',
    run_id: '22222222-2222-4222-8222-222222222222',
    observation_id: '33333333-3333-4333-8333-333333333333',
    stage: 'CLASSIFIER',
    ordinal: 1,
    provider: 'groq',
    model: 'classifier-primary',
    redelivered: false,
  }
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_durable_sis_v1_attempt') {
        return { data: [claim], error: null }
      }
      if (name === 'complete_durable_sis_v1_attempt') {
        completions.push(args ?? {})
        return { data: { status: 'QUEUED', stage: 'FINALIZE' }, error: null }
      }
      throw new Error(`unexpected RPC: ${name}`)
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data:
              table === 'observations'
                ? {
                    id: claim.observation_id,
                    source_id: '55555555-5555-4555-8555-555555555555',
                    title: 'Routine technical capability update',
                    content:
                      'A primary source describes routine technical work without broader impact.',
                    url: 'https://source.example/evidence',
                  }
                : { name: 'Primary Source', type: 'primary', trust_score: 0.9 },
            error: null,
          }),
        }),
      }),
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
  const response = await POST(request)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    attempted: 1,
    status: 'QUEUED',
    stage: 'FINALIZE',
  })
  assert.equal(providerCalls, 1)
  assert.equal(completions.length, 1)

  const commit = completions[0] ?? {}
  const classifierResult = commit['p_validated_output'] as Record<string, unknown>
  assert.equal((classifierResult['sis'] as Record<string, unknown>)['final'], 1)
  assert.equal(classifierResult['decision'], 'DISCARD')
  assert.equal(commit['p_next_stage'], null)
  assert.equal(commit['p_finalization_outcome'], 'DISCARD')
  assert.deepEqual(commit['p_finalization_signal'], {})
  assert.equal(
    (commit['p_finalization_decision'] as Record<string, unknown>)['rejection_code'],
    'R-09',
  )
})
