import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { agentCompleteJSON } from '../agent'
import { __setBudgetReserverForTests } from '../budget-gate'
import { AIDeadlineExceededError } from '../deadline'
import { hasTargetedSisV3PreclaimBudget, type AIJSONExecutionPolicy } from '../execution-policy'
import { recordActualTokens } from '../tpm-manager'

const POLICY: AIJSONExecutionPolicy = {
  maxRetriesPerModel: 0,
  modelAttemptBudgetsMs: [2_500, 2_500, 2_500],
  reserveAfterChainMs: 500,
  maxFallbackBackoffMs: 100,
  stage: 'sis_v3_test',
}

describe('SIS v3 reserved model execution', () => {
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

  function completion(content: string): Response {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { total_tokens: 10 },
      }),
      { status: 200 },
    )
  }

  test('invalid response envelopes on 120b and 20b still reserve and execute the Cloudflare fallback', async () => {
    const attemptedModels: string[] = []
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      attemptedModels.push(body.model)
      if (attemptedModels.length < 3) {
        return new Response(JSON.stringify({ invalid: 'provider envelope' }), { status: 200 })
      }
      return completion('{"ok":true}')
    }) as typeof fetch

    const result = await agentCompleteJSON(
      'parser',
      [{ role: 'user', content: 'offline fixture' }],
      z.object({ ok: z.boolean() }),
      { maxTokens: 64 },
      Date.now() + 10_000,
      POLICY,
    )

    assert.equal(result.ok, true)
    assert.deepEqual(attemptedModels, [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      '@cf/zai-org/glm-4.7-flash',
    ])
  })

  test('429 receives only bounded backoff and leaves the 20b fallback its own chance', async () => {
    const attemptedModels: string[] = []
    const timestamps: number[] = []
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      attemptedModels.push(body.model)
      timestamps.push(Date.now())
      if (attemptedModels.length === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '0.02' },
        })
      }
      return completion('{"ok":true}')
    }) as typeof fetch

    const result = await agentCompleteJSON(
      'parser',
      [{ role: 'user', content: 'offline fixture' }],
      z.object({ ok: z.boolean() }),
      { maxTokens: 64 },
      Date.now() + 10_000,
      POLICY,
    )

    assert.equal(result.ok, true)
    assert.deepEqual(attemptedModels.slice(0, 2), ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
    assert.ok((timestamps[1] ?? 0) - (timestamps[0] ?? 0) >= 15)
  })

  test('invalid envelope plus TPM waits preserves safe partial diagnostics through deadline', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ invalid: 'provider envelope' }), {
        status: 200,
      })) as typeof fetch

    // Saturate only the two fallback models after the primary has returned
    // its contract defect. Their TPM waits fail fast inside their separately
    // reserved windows; neither prompt nor response content is representable.
    recordActualTokens('openai/gpt-oss-20b', 100_000, 0)
    recordActualTokens('@cf/zai-org/glm-4.7-flash', 100_000, 0)

    await assert.rejects(
      agentCompleteJSON(
        'parser',
        [{ role: 'user', content: 'offline fixture' }],
        z.object({ ok: z.boolean() }),
        { maxTokens: 64 },
        Date.now() + 10_000,
        POLICY,
      ),
      (error: unknown) => {
        assert.ok(error instanceof AIDeadlineExceededError)
        assert.ok(
          error.diagnostics.some(
            (diagnostic) =>
              diagnostic.kind === 'model_contract' &&
              diagnostic.failureType === 'invalid_response_envelope' &&
              diagnostic.model === 'openai/gpt-oss-120b',
          ),
        )
        assert.ok(
          error.diagnostics.some(
            (diagnostic) =>
              diagnostic.kind === 'tpm_wait' &&
              diagnostic.model === 'openai/gpt-oss-20b' &&
              typeof diagnostic.tpmWaitMs === 'number',
          ),
        )
        assert.ok(
          error.diagnostics.every(
            (diagnostic) => !('content' in diagnostic) && !('prompt' in diagnostic),
          ),
        )
        return true
      },
    )
  })
})

describe('SIS v3 preclaim budget', () => {
  test('requires time plus independent classifier and parser TPM capacity', () => {
    assert.equal(
      hasTargetedSisV3PreclaimBudget({
        remainingMs: 47_000,
        classifierTPMAllowed: true,
        parserTPMAllowed: true,
      }),
      true,
    )
    assert.equal(
      hasTargetedSisV3PreclaimBudget({
        remainingMs: 46_999,
        classifierTPMAllowed: true,
        parserTPMAllowed: true,
      }),
      false,
    )
    assert.equal(
      hasTargetedSisV3PreclaimBudget({
        remainingMs: 60_000,
        classifierTPMAllowed: false,
        parserTPMAllowed: true,
      }),
      false,
    )
    assert.equal(
      hasTargetedSisV3PreclaimBudget({
        remainingMs: 60_000,
        classifierTPMAllowed: true,
        parserTPMAllowed: false,
      }),
      false,
    )
  })
})
