import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('score 2.8 ARCHIVE reaches parser and finalizes a non-public WEAK signal', async (t) => {
  const classifierOutput = {
    sis_novelty: 4,
    sis_importance: 4,
    sis_urgency: 3,
    sis_confidence: 4,
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
      'The technical change is credible but remains limited to one niche. It does not yet alter the broader ecosystem.',
  }
  const parserOutput = {
    title: 'Primary source documents a bounded technical advance',
    description:
      'The primary source documents a bounded technical advance. The evidence supports monitoring without claiming broad ecosystem impact.',
    category: 'RESEARCH',
    impact_factor: 7,
    actor_factor: 7,
    novelty_factor: 7,
    verifiability_factor: 7,
    strategic_factor: 7,
    authority_factor: 7,
    corroboration_factor: 2,
    specificity_factor: 7,
    category_confidence_factor: 7,
    entities: [{ name: 'Technical System', type: 'TECHNOLOGY' }],
    is_duplicate: false,
    duplicate_note: null,
    is_marketing: false,
    novelty_prior_example: null,
  }
  const providerCalls: string[] = []
  const completions: Array<Record<string, unknown>> = []
  const claims = [
    {
      message_id: 201,
      attempt_id: '11111111-1111-4111-8111-111111111111',
      run_id: '22222222-2222-4222-8222-222222222222',
      observation_id: '33333333-3333-4333-8333-333333333333',
      stage: 'CLASSIFIER',
      ordinal: 1,
      provider: 'groq',
      model: 'classifier-primary',
      redelivered: false,
    },
    {
      message_id: 202,
      attempt_id: '44444444-4444-4444-8444-444444444444',
      run_id: '22222222-2222-4222-8222-222222222222',
      observation_id: '33333333-3333-4333-8333-333333333333',
      stage: 'PARSER',
      ordinal: 1,
      provider: 'groq',
      model: 'parser-primary',
      redelivered: false,
    },
  ]

  const aiMock = mock.module('@/lib/ai/client', {
    namedExports: {
      callProviderJSON: async (ref: { model: string }) => {
        providerCalls.push(ref.model)
        return ref.model === 'classifier-primary' ? classifierOutput : parserOutput
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

  const observation = {
    id: '33333333-3333-4333-8333-333333333333',
    source_id: '55555555-5555-4555-8555-555555555555',
    title: 'Bounded technical capability update',
    content: 'A primary source documents a focused technical capability with verifiable evidence.',
    url: 'https://source.example/evidence',
  }
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_durable_sis_v1_attempt') {
        return { data: [claims.shift()], error: null }
      }
      if (name === 'complete_durable_sis_v1_attempt') {
        completions.push(args ?? {})
        return {
          data: {
            status: 'QUEUED',
            stage: completions.length === 1 ? 'PARSER' : 'FINALIZE',
          },
          error: null,
        }
      }
      throw new Error(`unexpected RPC: ${name}`)
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data:
              table === 'observations'
                ? observation
                : table === 'sources'
                  ? { name: 'Primary Source', type: 'primary', trust_score: 0.9 }
                  : { classifier_output: completions[0]?.['p_validated_output'] },
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

  assert.equal((await POST(request)).status, 200)
  assert.equal((await POST(request)).status, 200)
  assert.deepEqual(providerCalls, ['classifier-primary', 'parser-primary'])

  const classifierCommit = completions[0] ?? {}
  const classifierResult = classifierCommit['p_validated_output'] as Record<string, unknown>
  assert.equal((classifierResult['sis'] as Record<string, unknown>)['final'], 2.8)
  assert.equal(classifierResult['decision'], 'ARCHIVE')
  assert.equal(classifierCommit['p_next_stage'], 'PARSER')
  assert.equal(classifierCommit['p_finalization_outcome'], null)

  const parserCommit = completions[1] ?? {}
  assert.equal(parserCommit['p_finalization_outcome'], 'WEAK_SIGNAL')
  assert.deepEqual(parserCommit['p_finalization_signal'], {
    ...parserOutput,
    signal_score: 70,
    confidence_score: 58,
    momentum_score: 20,
  })
  assert.equal(
    (parserCommit['p_finalization_decision'] as Record<string, unknown>)['rejection_code'],
    undefined,
  )
})
