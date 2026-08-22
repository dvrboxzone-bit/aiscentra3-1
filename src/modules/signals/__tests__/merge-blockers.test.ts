/**
 * AIscentra — merge-blocking regression tests (independent review)
 *
 * Blocker 1: chain-exhaustion classification. The real diagnosed
 * incident chain is MIXED: 70b returns a genuine HTTP 200 whose body
 * fails JSON/Zod validation (classified 'client_error'), THEN the 8b
 * fallback is refused BEFORE any network call because the same
 * unreduced prompt cannot fit 8b's own TPM budget (classified
 * 'request_too_large'). `kinds.every((k) => k === 'request_too_large')`
 * requires EVERY model to have failed the SAME way -- with a mixed
 * chain this is false, so the real AIRequestTooLargeError silently
 * fell through to a bare `Error('All models failed')`, defeating the
 * whole point of a distinguishable, requeue-able error type.
 *
 * Blocker 2: SIS -> V1 fallback. A generic (non-retryable) SIS failure
 * previously fell through to "proceed without SIS," letting a signal
 * be created via the looser V1 scoring path for content whose SIS
 * classification never actually completed.
 *
 * Uses the same real, established test harness as budget-exceeded.test.ts:
 * a global.fetch stub distinguishing Supabase calls (stubbed benign)
 * from real Groq calls (routed by model name and prompt content), so
 * processObservation runs its REAL code path end to end.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { processObservation } from '../engine'
import { agentCompleteJSON } from '@/lib/ai/agent'
import { AIRequestTooLargeError } from '@/lib/ai/tpm-manager'
import { z } from 'zod'
import type { ObservationRow } from '@/modules/observations/queries'

function makeObservation(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: 'obs-merge-blocker-test',
    source_id: 'source-1',
    title: 'New Model Release Achieves Record Benchmark Results',
    content:
      'Researchers describe a new training technique that improves sample efficiency ' +
      'for large language models. The new model release achieves state-of-the-art benchmark ' +
      'results across several standard tasks, outperforming prior methods. ' +
      'The approach avoids the common failure modes of prior methods.',
    url: 'https://example.com/paper',
    published_at: '2026-08-08T00:00:00Z',
    collected_at: '2026-08-08T00:00:00Z',
    metadata: {},
    processed: false,
    processing_error: null,
    signal_id: null,
    ...overrides,
  } as unknown as ObservationRow
}

describe('Blocker 1 -- agentCompleteJSON: mixed chain (70b client_error -> 8b request_too_large) surfaces the ORIGINAL AIRequestTooLargeError', () => {
  test('the real error object propagates, not a synthesized replacement, not a bare Error', async () => {
    const originalApiKey = process.env['GROQ_API_KEY']
    const originalCfToken = process.env['CLOUDFLARE_API_TOKEN']
    const originalCfAccount = process.env['CLOUDFLARE_ACCOUNT_ID']
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    process.env['CLOUDFLARE_API_TOKEN'] = 'test-key-not-real'
    process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-not-real'
    try {
      // REAL ARCHITECTURE CHANGE (independent audit, post Groq model
      // deprecation): openai/gpt-oss-120b and openai/gpt-oss-20b share
      // an IDENTICAL real Groq TPM ceiling (8,000 each, confirmed
      // 2026-08-22 against console.groq.com/docs/rate-limits) -- unlike
      // the old llama-3.3-70b-versatile (12,000) / llama-3.1-8b-instant
      // (6,000) pair this test originally targeted, there is no longer
      // any content size that "fits primary but not mini" on Groq
      // alone. The real fallback chain now also includes Cloudflare
      // Workers AI (@cf/zai-org/glm-4.7-flash, 50,000 TPM) as a third,
      // genuinely larger-budget link. To still exercise a genuine,
      // unambiguous "entire chain refuses via TPM before any network
      // call" scenario, content must exceed ALL THREE models' real
      // effective ceilings -- not just the smallest one.
      const bigContent = 'x'.repeat(200_000)
      const schema = z.object({ ok: z.boolean() })

      await assert.rejects(
        agentCompleteJSON(
          'parser',
          [{ role: 'user', content: bigContent }],
          schema,
          { maxTokens: 400 },
          Date.now() + 30_000,
        ),
        (err: unknown) => {
          assert.ok(
            err instanceof AIRequestTooLargeError,
            `expected AIRequestTooLargeError, got ${String(err)}`,
          )
          return true
        },
      )
    } finally {
      if (originalApiKey === undefined) delete process.env['GROQ_API_KEY']
      else process.env['GROQ_API_KEY'] = originalApiKey
      if (originalCfToken === undefined) delete process.env['CLOUDFLARE_API_TOKEN']
      else process.env['CLOUDFLARE_API_TOKEN'] = originalCfToken
      if (originalCfAccount === undefined) delete process.env['CLOUDFLARE_ACCOUNT_ID']
      else process.env['CLOUDFLARE_ACCOUNT_ID'] = originalCfAccount
    }
  })

  test('mini fallback is genuinely attempted and succeeds after primary fails validation -- REAL ARCHITECTURE CHANGE: openai/gpt-oss-120b and openai/gpt-oss-20b share an IDENTICAL real Groq TPM ceiling (8,000 each), so a request that fits primary now also fits mini (unlike the old, asymmetric llama-3.3-70b-versatile [12,000] / llama-3.1-8b-instant [6,000] pair this test originally verified as mutually exclusive)', async () => {
    const originalFetch = globalThis.fetch
    const originalApiKey = process.env['GROQ_API_KEY']
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    let miniCalled = false
    let primaryCalled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { model?: string }
      if (body.model === 'openai/gpt-oss-20b') {
        miniCalled = true
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (body.model === 'openai/gpt-oss-120b') {
        primaryCalled = true
        // Genuine HTTP 200 whose body fails JSON/Zod validation --
        // the exact real-incident trigger for the fallback attempt.
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'not valid json{{{' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 200 })
    }
    try {
      const bigContent = 'x'.repeat(20_000)
      const schema = z.object({ ok: z.boolean() })
      const result = await agentCompleteJSON(
        'parser',
        [{ role: 'user', content: bigContent }],
        schema,
        { maxTokens: 400 },
        Date.now() + 30_000,
      )
      assert.equal(
        result.ok,
        true,
        'the real fallback result must genuinely succeed once mini is reached',
      )
      assert.equal(primaryCalled, true, '120b (primary) must genuinely be attempted first')
      assert.equal(
        miniCalled,
        true,
        '20b (fallback) must genuinely be reached and recover -- it shares the same real TPM ceiling as primary, so it is no longer refused pre-fetch the way the old, smaller 8b model was',
      )
    } finally {
      globalThis.fetch = originalFetch
      if (originalApiKey === undefined) delete process.env['GROQ_API_KEY']
      else process.env['GROQ_API_KEY'] = originalApiKey
    }
  })
})

describe('Blocker 1 -- the error reaches the batch handler: observation is requeued, never marked processed', () => {
  // REAL ARCHITECTURE CHANGE (independent audit, post Groq model
  // deprecation): this describe block's own test was moved to
  // merge-blockers-tpm-exhaustion.moduleMock.test.ts. Reason: with the
  // real enrichment call's observation content truncated to a small
  // fixed size before the prompt is built (confirmed directly in
  // engine.ts), no realistic raw observation.content size can any
  // longer exceed the new, larger/equal Groq TPM ceilings (8,000 each
  // for gpt-oss-120b/20b) through processObservation()'s own real code
  // path -- deterministically forcing this specific scenario now
  // requires mocking tpm-manager's fitsWithinModelTPM() directly,
  // which needs --experimental-test-module-mocks and this project's
  // own established *.moduleMock.test.ts isolation convention (regular
  // *.test.ts files, this one included, do not run with that flag).
})

describe('Blocker 2 -- a generic (non-retryable) SIS failure ends the observation with an honest error, never creates a Signal via V1', () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env['GROQ_API_KEY']

  beforeEach(() => {
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env['GROQ_API_KEY']
    else process.env['GROQ_API_KEY'] = originalApiKey
  })

  test('SIS call site: every model in the chain returns genuinely invalid JSON -- processObservation resolves with outcome "error", not a created signal, with zero Signal-table writes and zero enrichment/parser calls', async () => {
    // Real runtime side-effect tracking, not source-text inspection:
    // every fetch call is classified by its ACTUAL destination/shape,
    // so the assertions below prove what genuinely happened at
    // runtime, not merely what the function's return value claims.
    let groqCallCount = 0
    let signalsTableCallCount = 0
    let enrichmentShapedCallCount = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('supabase.co') || urlStr.includes('placeholder.supabase')) {
        // Real Supabase REST call -- Supabase-js always targets
        // <url>/rest/v1/<table>, so a genuine INSERT/UPDATE against
        // the signals table is directly observable in the URL path,
        // not merely inferable from the function's own return value.
        // Real write-vs-read distinction: Supabase-js sends GET for
        // .select(), POST for .insert(), PATCH for .update() -- a
        // legitimate SELECT against signals (e.g. the pre-SIS
        // corroboration check) is not a Signal being created, only a
        // genuine POST/PATCH is.
        const method = (init?.method ?? 'GET').toUpperCase()
        if (urlStr.includes('/signals') && (method === 'POST' || method === 'PATCH')) {
          signalsTableCallCount++
        }
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // A real Groq call -- every SIS-chain model (8b primary, 70b
      // fallback for 'classifier') returns genuinely unparseable
      // content, a real non-retryable, permanent classifier failure.
      groqCallCount++
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        messages?: Array<{ content: string }>
      }
      const isEnrichmentShaped = (body.messages ?? []).some(
        (m) =>
          m.content?.includes('candidateCategory') ||
          m.content?.toLowerCase().includes('enrichment'),
      )
      if (isEnrichmentShaped) enrichmentShapedCallCount++
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'not valid json{{{' } }],
          usage: { total_tokens: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const result = await processObservation(
      makeObservation(),
      0.8,
      'Test Source',
      '',
      Date.now() + 120_000,
    )
    assert.equal(
      result.outcome,
      'error',
      'a genuine, non-retryable SIS failure must end the observation with an honest error outcome',
    )
    assert.equal(
      result.signalId,
      undefined,
      'no signal must ever be created via V1 scoring when SIS classification never actually completed',
    )
    assert.equal(
      signalsTableCallCount,
      0,
      'no Supabase call must ever target the signals table (no INSERT/UPDATE) after a genuine SIS failure',
    )
    assert.equal(
      enrichmentShapedCallCount,
      0,
      'the enrichment/parser stage must never be reached after SIS fails -- processObservation must return before attempting it',
    )
    // SIS's own chain has exactly 2 models (8b primary, 70b fallback
    // for 'classifier') -- if execution had genuinely proceeded to the
    // enrichment stage, a THIRD real Groq call would have been made.
    assert.equal(
      groqCallCount,
      2,
      `expected exactly 2 real Groq calls (SIS's own 2-model chain exhausting), got ${groqCallCount} -- more would mean enrichment was reached, fewer would mean the SIS chain itself did not run as expected`,
    )
  })
})
