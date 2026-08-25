import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { agentCompleteJSON } from '../agent'
import { __setBudgetReserverForTests } from '../budget-gate'
import { callProviderJSON } from '../client'
import {
  buildLockScopedTPMAvailability,
  createTargetedSisV4ReservationPlan,
  type AIJSONExecutionPolicy,
} from '../execution-policy'
import { AIStructuredOutputError } from '../structured-output'

const V4_TEST_POLICY: AIJSONExecutionPolicy = {
  maxRetriesPerModel: 0,
  modelAttemptBudgetsMs: [2_200, 2_200, 2_200],
  reserveAfterChainMs: 500,
  maxFallbackBackoffMs: 0,
  stage: 'sis_v4_test',
  reservedModels: ['openai/gpt-oss-120b', '@cf/zai-org/glm-4.7-flash'],
  carryForwardUnusedTime: true,
}

describe('SIS v4 lock-scoped reservation planning', () => {
  const classifierChain = [
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'cloudflare', model: '@cf/zai-org/glm-4.7-flash' },
  ]
  const parserChain = [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'cloudflare', model: '@cf/zai-org/glm-4.7-flash' },
  ]

  test('accounts for the shared 20b bucket and reserves an independent parser fallback', () => {
    const models = [...new Set([...classifierChain, ...parserChain].map((ref) => ref.model))]
    const availability = buildLockScopedTPMAvailability({
      models,
      rows: [
        { model: 'openai/gpt-oss-20b', tokens: 0 },
        { model: 'openai/gpt-oss-120b', tokens: 0 },
      ],
      capacityForModel: (model) => (model === '@cf/zai-org/glm-4.7-flash' ? 42_500 : 6_800),
    })
    assert.ok(availability)
    const plan = createTargetedSisV4ReservationPlan({
      remainingMs: 50_000,
      lockLeaseVerified: true,
      classifierChain,
      parserChain,
      estimatedTokens: 4_000,
      checkTPM: (model) => availability.get(model) ?? { allowed: false, remainingTokens: 0 },
    })

    assert.deepEqual(plan, {
      classifierModels: ['openai/gpt-oss-20b'],
      parserModels: ['openai/gpt-oss-120b', '@cf/zai-org/glm-4.7-flash'],
      reservedTokensByModel: {
        'openai/gpt-oss-20b': 4_000,
        'openai/gpt-oss-120b': 4_000,
        '@cf/zai-org/glm-4.7-flash': 4_000,
      },
    })
  })

  test('rejects malformed shared-ledger rows instead of trusting local state', () => {
    assert.equal(
      buildLockScopedTPMAvailability({
        models: ['openai/gpt-oss-20b'],
        rows: [{ model: 'openai/gpt-oss-20b', tokens: 'unknown' }],
        capacityForModel: () => 6_800,
      }),
      null,
    )
  })

  test('fails closed before claim when the durable shared lease cannot be proved', () => {
    let tpmReads = 0
    const plan = createTargetedSisV4ReservationPlan({
      remainingMs: 50_000,
      lockLeaseVerified: false,
      classifierChain,
      parserChain,
      estimatedTokens: 4_000,
      checkTPM: () => {
        tpmReads++
        return { allowed: true, remainingTokens: 42_500 }
      },
    })

    assert.equal(plan, null)
    assert.equal(tpmReads, 0)
  })
})

describe('SIS v4 production-shaped fallback execution', () => {
  const originalFetch = globalThis.fetch
  const originalGroqKey = process.env['GROQ_API_KEY']
  const originalCloudflareKey = process.env['CLOUDFLARE_API_TOKEN']
  let restoreBudget: (() => void) | undefined

  beforeEach(() => {
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    process.env['CLOUDFLARE_API_TOKEN'] = 'test-key-not-real'
    restoreBudget = __setBudgetReserverForTests(async () => {})
  })

  afterEach(() => {
    restoreBudget?.()
    globalThis.fetch = originalFetch
    if (originalGroqKey === undefined) delete process.env['GROQ_API_KEY']
    else process.env['GROQ_API_KEY'] = originalGroqKey
    if (originalCloudflareKey === undefined) delete process.env['CLOUDFLARE_API_TOKEN']
    else process.env['CLOUDFLARE_API_TOKEN'] = originalCloudflareKey
  })

  test('classifies 120b length plus empty content as safe output_truncated metadata', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
          usage: { total_tokens: 1_024 },
        }),
        { status: 200 },
      )) as typeof fetch

    await assert.rejects(
      callProviderJSON(
        { provider: 'groq', model: 'openai/gpt-oss-120b' },
        [{ role: 'user', content: 'offline fixture' }],
        z.object({ ok: z.boolean() }),
        { maxTokens: 1_024 },
        Date.now() + 5_000,
      ),
      (error: unknown) => {
        assert.ok(error instanceof AIStructuredOutputError)
        assert.deepEqual(error.diagnostic, {
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          failureType: 'output_truncated',
          httpStatus: 200,
          finishReason: 'length',
          contentLength: 0,
          contentEmpty: true,
        })
        assert.equal('content' in error.diagnostic, false)
        assert.equal('reasoning' in error.diagnostic, false)
        return true
      },
    )
  })

  test('skips unavailable shared 20b and gives delayed Cloudflare the carried-forward attempt', async () => {
    const attemptedModels: string[] = []
    const startedAt = Date.now()
    const jobDeadlineAt = startedAt + 7_200
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      attemptedModels.push(body.model)
      if (body.model === 'openai/gpt-oss-120b') {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '' }, finish_reason: 'length' }],
            usage: { total_tokens: 1_024 },
          }),
          { status: 200 },
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 2_600))
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: { total_tokens: 20 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const result = await agentCompleteJSON(
      'parser',
      [{ role: 'user', content: 'offline fixture' }],
      z.object({ ok: z.boolean() }),
      { maxTokens: 64 },
      jobDeadlineAt,
      V4_TEST_POLICY,
    )

    assert.equal(result.ok, true)
    assert.deepEqual(attemptedModels, ['openai/gpt-oss-120b', '@cf/zai-org/glm-4.7-flash'])
    assert.ok(Date.now() < jobDeadlineAt, 'the overall job deadline must not be increased')
  })
})
