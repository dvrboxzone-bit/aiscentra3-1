import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('truncation, local deadline, and truncated envelope end as technical FAILED', async (t) => {
  class StructuredFailure extends Error {
    constructor(
      readonly diagnostic: {
        failureType: 'output_truncated'
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
  class DeadlineFailure extends Error {}

  const failures = [
    new StructuredFailure({
      failureType: 'output_truncated',
      provider: 'groq',
      model: 'groq-truncated',
      httpStatus: 200,
      finishReason: 'length',
      contentLength: 0,
    }),
    new DeadlineFailure('local TPM guard denied a full attempt window'),
    new EnvelopeFailure({
      provider: 'cloudflare',
      model: 'cloudflare-truncated-envelope',
      httpStatus: 200,
      finishReason: 'length',
      contentLength: 8254,
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
    namedExports: { AIDeadlineExceededError: DeadlineFailure },
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
    { provider: 'groq', model: 'groq-truncated' },
    { provider: 'groq', model: 'groq-deadline' },
    { provider: 'cloudflare', model: 'cloudflare-truncated-envelope' },
  ].map((model, index) => ({
    message_id: index + 1,
    attempt_id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    run_id: `10000000-0000-4000-8000-00000000000${index + 1}`,
    observation_id: 'e4275483-39e4-4441-84a2-0a1df546cf07',
    stage: 'PARSER',
    ordinal: 3,
    redelivered: false,
    ...model,
  }))
  let activeClaim: (typeof claims)[number] | undefined
  const failedCommits: Array<Record<string, unknown>> = []
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
      throw new Error(`technical failure must not call ${name}`)
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data:
              table === 'observations'
                ? {
                    id: 'e4275483-39e4-4441-84a2-0a1df546cf07',
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
      getModelChain: () => {
        const current = activeClaim
        return current ? [{ provider: current.provider, model: current.model }] : []
      },
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
  for (let index = 0; index < 3; index += 1) {
    const response = await POST(request)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, 'FAILED')
  }

  assert.deepEqual(
    failedCommits.map((commit) => ({
      status: commit['p_attempt_status'],
      diagnostic: (commit['p_safe_diagnostic'] as Record<string, unknown>)['type'],
    })),
    [
      { status: 'TERMINAL', diagnostic: 'output_truncated' },
      { status: 'TERMINAL', diagnostic: 'deadline_exceeded' },
      { status: 'TERMINAL', diagnostic: 'invalid_response_envelope' },
    ],
  )
  for (const commit of failedCommits) {
    const diagnostic = commit['p_safe_diagnostic'] as Record<string, unknown>
    for (const forbidden of ['raw_prompt', 'raw_response', 'content', 'reasoning']) {
      assert.equal(forbidden in diagnostic, false)
    }
  }
})
