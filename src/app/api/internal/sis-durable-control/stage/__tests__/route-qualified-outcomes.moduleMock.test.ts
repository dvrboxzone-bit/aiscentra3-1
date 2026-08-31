import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('WEAK_SIGNAL and SIGNAL both reach parser and preserve their finalization outcome', async (t) => {
  const classifierOutputs = [
    {
      sis_novelty: 6,
      sis_importance: 6,
      sis_urgency: 5,
      sis_confidence: 6,
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
        'The primary evidence is credible and relevant, with bounded strategic impact.',
    },
    {
      sis_novelty: 7,
      sis_importance: 8,
      sis_urgency: 8,
      sis_confidence: 8,
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
        'The primary evidence documents a material technical change with broad strategic impact.',
    },
  ]
  const parserOutputs = [
    {
      title: 'Primary source documents a relevant technical change',
      description:
        'The primary source documents a relevant technical change. The evidence supports a non-public weak Signal for continued monitoring.',
      category: 'RESEARCH',
      impact_factor: 6,
      actor_factor: 6,
      novelty_factor: 6,
      verifiability_factor: 7,
      strategic_factor: 6,
      authority_factor: 7,
      corroboration_factor: 2,
      specificity_factor: 7,
      category_confidence_factor: 7,
      entities: [{ name: 'Technical System', type: 'TECHNOLOGY' }],
      is_duplicate: false,
      duplicate_note: null,
      is_marketing: false,
      novelty_prior_example: null,
    },
    {
      title: 'Primary source documents a material technical change',
      description:
        'The primary source documents a material technical change. The evidence supports a draft Signal pending explicit quality approval.',
      category: 'MODELS',
      impact_factor: 8,
      actor_factor: 8,
      novelty_factor: 8,
      verifiability_factor: 8,
      strategic_factor: 8,
      authority_factor: 8,
      corroboration_factor: 2,
      specificity_factor: 8,
      category_confidence_factor: 8,
      entities: [{ name: 'Technical System', type: 'TECHNOLOGY' }],
      is_duplicate: false,
      duplicate_note: null,
      is_marketing: false,
      novelty_prior_example: null,
    },
  ]
  const runIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
  const observationIds = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ]
  const claims = runIds.flatMap((runId, index) => [
    {
      message_id: 301 + index * 2,
      attempt_id: `${5 + index * 2}5555555-5555-4555-8555-555555555555`,
      run_id: runId,
      observation_id: observationIds[index],
      stage: 'CLASSIFIER',
      ordinal: 1,
      provider: 'groq',
      model: 'classifier-primary',
      redelivered: false,
    },
    {
      message_id: 302 + index * 2,
      attempt_id: `${6 + index * 2}6666666-6666-4666-8666-666666666666`,
      run_id: runId,
      observation_id: observationIds[index],
      stage: 'PARSER',
      ordinal: 1,
      provider: 'groq',
      model: 'parser-primary',
      redelivered: false,
    },
  ])
  const allClaims = [...claims]
  const completions: Array<Record<string, unknown>> = []
  const classifierByRun = new Map<string, unknown>()
  const providerCalls: string[] = []
  let classifierIndex = 0
  let parserIndex = 0

  const aiMock = mock.module('@/lib/ai/client', {
    namedExports: {
      callProviderJSON: async (ref: { model: string }) => {
        providerCalls.push(ref.model)
        if (ref.model === 'classifier-primary') return classifierOutputs[classifierIndex++]
        return parserOutputs[parserIndex++]
      },
      estimateRequestTokens: () => 100,
      AIInvalidResponseEnvelopeError: class extends Error {},
      AIProviderError: class extends Error {},
      MAX_PROVIDER_ERROR_MESSAGE_LENGTH: 300,
    },
  })
  const tpmMock = mock.module('@/lib/ai/tpm-manager', {
    namedExports: {
      checkTPMBudget: () => ({ allowed: true }),
      fitsWithinModelTPM: () => ({ fits: true, modelCeiling: 6_800 }),
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
      ],
    },
  })
  const guardMock = mock.module('@/lib/security/cron-guard', {
    namedExports: { isAuthorizedCronRequest: () => true },
  })

  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_durable_sis_v1_attempt') {
        return { data: [claims.shift()], error: null }
      }
      if (name === 'complete_durable_sis_v1_attempt') {
        const completion = args ?? {}
        completions.push(completion)
        const attemptId = String(completion['p_attempt_id'])
        const claim = allClaims.find((candidate) => candidate.attempt_id === attemptId)
        if (claim?.stage === 'CLASSIFIER') {
          classifierByRun.set(claim.run_id, completion['p_validated_output'])
        }
        return {
          data: {
            status: 'QUEUED',
            stage: claim?.stage === 'CLASSIFIER' ? 'PARSER' : 'FINALIZE',
          },
          error: null,
        }
      }
      throw new Error(`unexpected RPC: ${name}`)
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: unknown) => ({
          single: async () => ({
            data:
              table === 'observations'
                ? {
                    id: value,
                    source_id: '99999999-9999-4999-8999-999999999999',
                    title: 'Qualified technical capability update',
                    content:
                      'A primary source documents a material technical capability with verifiable evidence.',
                    url: 'https://source.example/evidence',
                  }
                : table === 'sources'
                  ? { name: 'Primary Source', type: 'primary', trust_score: 0.9 }
                  : { classifier_output: classifierByRun.get(String(value)) },
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
    tpmMock.restore()
    aiMock.restore()
  })

  const { POST } = await import('../route')
  const request = new Request('https://aiscentra.test/api/internal/sis-durable-control/stage', {
    method: 'POST',
  })

  for (let index = 0; index < 4; index += 1) {
    assert.equal((await POST(request)).status, 200)
  }

  assert.deepEqual(providerCalls, [
    'classifier-primary',
    'parser-primary',
    'classifier-primary',
    'parser-primary',
  ])

  const weakClassifier = completions[0] ?? {}
  assert.equal(
    (weakClassifier['p_validated_output'] as Record<string, unknown>)['decision'],
    'WEAK_SIGNAL',
  )
  assert.equal(weakClassifier['p_next_stage'], 'PARSER')
  assert.equal((completions[1] ?? {})['p_finalization_outcome'], 'WEAK_SIGNAL')

  const signalClassifier = completions[2] ?? {}
  assert.equal(
    (signalClassifier['p_validated_output'] as Record<string, unknown>)['decision'],
    'SIGNAL',
  )
  assert.equal(signalClassifier['p_next_stage'], 'PARSER')
  assert.equal((completions[3] ?? {})['p_finalization_outcome'], 'SIGNAL')
})
