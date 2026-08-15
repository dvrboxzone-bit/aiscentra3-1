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

const SIS_JSON = JSON.stringify({
  sis_novelty: 5,
  sis_importance: 5,
  sis_urgency: 5,
  sis_confidence: 8,
  human_cto: true,
  anti_hype_score: 5,
  relevance_horizon: 'MONTHS',
  event_type: 'DISCRETE_EVENT',
  engine_justification: 'Genuine benchmark improvement with reproducible results across tasks.',
})

describe('Blocker 1 -- agentCompleteJSON: mixed chain (70b client_error -> 8b request_too_large) surfaces the ORIGINAL AIRequestTooLargeError', () => {
  test('the real error object propagates, not a synthesized replacement, not a bare Error', async () => {
    const originalApiKey = process.env['GROQ_API_KEY']
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    try {
      // Deliberately oversized for the 8b fallback (>5,100 effective
      // TPM) but comfortably within the 70b primary's own budget
      // (~10,200 effective TPM) -- forces the exact real incident
      // shape: 70b is attempted first (its own budget is fine), fails
      // validation, THEN the identical oversized prompt is attempted
      // against 8b, which must refuse before any network call.
      const bigContent = 'x'.repeat(20_000)
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
    }
  })

  test('the 8b fallback network call never happens for the oversized request -- refused before any fetch', async () => {
    const originalFetch = globalThis.fetch
    const originalApiKey = process.env['GROQ_API_KEY']
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    let miniCalled = false
    let primaryCalled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { model?: string }
      if (body.model === 'llama-3.1-8b-instant') miniCalled = true
      if (body.model === 'llama-3.3-70b-versatile') {
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
      await assert.rejects(
        agentCompleteJSON(
          'parser',
          [{ role: 'user', content: bigContent }],
          schema,
          { maxTokens: 400 },
          Date.now() + 30_000,
        ),
      )
      assert.equal(primaryCalled, true, '70b (primary) must genuinely be attempted first')
      assert.equal(
        miniCalled,
        false,
        '8b (fallback) must NEVER be contacted -- the oversized request must be refused before any network call',
      )
    } finally {
      globalThis.fetch = originalFetch
      if (originalApiKey === undefined) delete process.env['GROQ_API_KEY']
      else process.env['GROQ_API_KEY'] = originalApiKey
    }
  })
})

describe('Blocker 1 -- the error reaches the batch handler: observation is requeued, never marked processed', () => {
  test('processObservation itself propagates AIRequestTooLargeError for the exact incident-shaped chain (SIS succeeds, enrichment chain exhausts on request_too_large)', async () => {
    const originalFetch = globalThis.fetch
    const originalApiKey = process.env['GROQ_API_KEY']
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('supabase.co') || urlStr.includes('placeholder.supabase')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        model?: string
        messages?: Array<{ content: string }>
      }
      const isSisCall = (body.messages ?? []).some((m) =>
        m.content?.includes('AIscentra Intelligence Analyst'),
      )
      if (isSisCall) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: SIS_JSON } }],
            usage: { total_tokens: 50 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      // Enrichment (parser) stage: 70b returns a genuine 200 with an
      // invalid body; the SAME real production trigger as above.
      if (body.model === 'llama-3.3-70b-versatile') {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'not valid json{{{' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(
        `unexpected fetch to model ${String(body.model)} -- 8b fallback must be refused before any network call`,
      )
    }
    try {
      // A large-content observation forces the enrichment prompt past
      // 8b's own TPM ceiling once it falls back, mirroring the real
      // incident's oversized fallback attempt.
      const obs = makeObservation({
        content: 'Large content. '.repeat(1_500),
      } as Partial<ObservationRow>)
      await assert.rejects(
        processObservation(obs, 0.8, 'Test Source', '', Date.now() + 120_000),
        (err: unknown) => err instanceof AIRequestTooLargeError,
        'processObservation must reject with the real AIRequestTooLargeError, not swallow it into a permanent error',
      )
    } finally {
      globalThis.fetch = originalFetch
      if (originalApiKey === undefined) delete process.env['GROQ_API_KEY']
      else process.env['GROQ_API_KEY'] = originalApiKey
    }
  })
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

  test('SIS call site: every model in the chain returns genuinely invalid JSON -- processObservation resolves with outcome "error", not a created signal', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = async (url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('supabase.co') || urlStr.includes('placeholder.supabase')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // Every SIS-chain model (8b primary, 70b fallback for
      // 'classifier') returns genuinely unparseable content -- a
      // real, non-retryable, permanent classifier failure.
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
  })
})
