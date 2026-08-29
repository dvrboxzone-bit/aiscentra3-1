import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('production parser schema-validation then truncated envelope end as technical FAILED', async (t) => {
  class StructuredFailure extends Error {
    constructor(
      readonly diagnostic: {
        failureType: 'schema_validation'
        provider: 'groq'
        model: string
        httpStatus: number
        finishReason: string
        contentLength: number
      },
    ) {
      super('safe structured failure')
    }
  }
  class EnvelopeFailure extends Error {
    constructor(
      readonly diagnostic: {
        provider: 'cloudflare'
        model: string
        httpStatus: number
        finishReason: string
        contentLength: number
      },
    ) {
      super('safe envelope failure')
    }
  }
  const failures = [
    new StructuredFailure({
      failureType: 'schema_validation',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      httpStatus: 200,
      finishReason: 'stop',
      contentLength: 796,
    }),
    new EnvelopeFailure({
      provider: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
      httpStatus: 200,
      finishReason: 'length',
      contentLength: 17_268,
    }),
  ]

  const aiMock = mock.module('@/lib/ai/client', {
    namedExports: {
      callProviderJSON: async () => {
        throw failures.shift()
      },
      estimateRequestTokens: () => 100,
      AIInvalidResponseEnvelopeError: EnvelopeFailure,
      AIProviderError: class extends Error {},
    },
  })
  const structuredMock = mock.module('@/lib/ai/structured-output', {
    namedExports: { AIStructuredOutputError: StructuredFailure },
  })
  const deadlineMock = mock.module('@/lib/ai/deadline', {
    namedExports: { AIDeadlineExceededError: class extends Error {} },
  })
  const tpmMock = mock.module('@/lib/ai/tpm-manager', {
    namedExports: {
      checkTPMBudget: () => ({ allowed: true }),
      fitsWithinModelTPM: () => ({ fits: true, modelCeiling: 6800 }),
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

  const claims = [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'cloudflare', model: '@cf/zai-org/glm-4.7-flash' },
  ].map((model, index) => ({
    message_id: index + 1,
    attempt_id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    run_id: '4f017a68-a7c2-4347-9388-9c3750e99bb6',
    observation_id: '010d5999-78d8-4a47-b7b2-749e354b4bf4',
    stage: 'PARSER',
    ordinal: index + 1,
    redelivered: false,
    ...model,
  }))
  let activeClaim: (typeof claims)[number] | undefined
  const failedCommits: Array<Record<string, unknown>> = []
  const retryCommits: Array<Record<string, unknown>> = []
  const db = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_durable_sis_v1_attempt') {
        activeClaim = claims.shift()
        return { data: [activeClaim], error: null }
      }
      if (name === 'fail_durable_sis_v1_stage') {
        failedCommits.push(args ?? {})
        return { data: { status: 'FAILED', stage: 'PARSER' }, error: null }
      }
      if (name === 'complete_durable_sis_v1_attempt') {
        retryCommits.push(args ?? {})
        return { data: { status: 'QUEUED', stage: 'PARSER' }, error: null }
      }
      throw new Error(`technical failure must not call ${name}`)
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data:
              table === 'observations'
                ? {
                    id: '010d5999-78d8-4a47-b7b2-749e354b4bf4',
                    source_id: '20000000-0000-4000-8000-000000000001',
                    title: 'Bounded technical control observation',
                    content: 'Primary evidence for the controlled parser contract.',
                    url: 'https://source.example/control',
                  }
                : { name: 'Primary Source', type: 'primary', trust_score: 0.9 },
            error: null,
          }),
        }),
      }),
    }),
  }
  const modelsMock = mock.module('@/lib/ai/models', {
    namedExports: {
      getModelChain: () => [
        { provider: 'groq', model: 'openai/gpt-oss-120b' },
        { provider: 'cloudflare', model: '@cf/zai-org/glm-4.7-flash' },
      ],
    },
  })
  const supabaseMock = mock.module('@/lib/supabase/server', {
    namedExports: { createAdminClient: () => db },
  })
  t.after(() => {
    supabaseMock.restore()
    modelsMock.restore()
    guardMock.restore()
    lockMock.restore()
    tpmMock.restore()
    deadlineMock.restore()
    structuredMock.restore()
    aiMock.restore()
  })

  const { POST } = await import('../route')
  const request = new Request('https://aiscentra.test/api/internal/sis-durable-control/stage', {
    method: 'POST',
  })
  for (let index = 0; index < 2; index += 1) {
    const response = await POST(request)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, index === 0 ? 'QUEUED' : 'FAILED')
  }

  assert.equal(retryCommits.length, 1)
  assert.equal(retryCommits[0]?.['p_status'], 'RETRYABLE')
  assert.equal(retryCommits[0]?.['p_next_provider'], 'cloudflare')
  assert.equal(retryCommits[0]?.['p_next_model'], '@cf/zai-org/glm-4.7-flash')
  assert.equal(
    (retryCommits[0]?.['p_safe_diagnostic'] as Record<string, unknown>)['type'],
    'schema_validation',
  )
  assert.deepEqual(
    failedCommits.map((commit) => ({
      status: commit['p_attempt_status'],
      diagnostic: (commit['p_safe_diagnostic'] as Record<string, unknown>)['type'],
    })),
    [{ status: 'TERMINAL', diagnostic: 'invalid_response_envelope' }],
  )
  for (const commit of [...retryCommits, ...failedCommits]) {
    const diagnostic = commit['p_safe_diagnostic'] as Record<string, unknown>
    for (const forbidden of ['raw_prompt', 'raw_response', 'content', 'reasoning']) {
      assert.equal(forbidden in diagnostic, false)
    }
  }
})
