/**
 * AIscentra — AITokenBudgetExceededError propagation through Signal Engine
 *
 * REAL BUG this guards: neither AI stage in processObservation()
 * (SIS classifier, enrichment/parser) recognized
 * AITokenBudgetExceededError at all -- it is neither AIProviderError
 * nor AIDeadlineExceededError, the only two types either catch block
 * checked. SIS silently fell through to "proceed without SIS" and
 * enrichment fell through to `return { outcome: 'error' }`, which the
 * batch handler then recorded as a PERMANENT processing_error -- for
 * an observation refused only because the shared TPD budget was
 * temporarily exhausted.
 *
 * Uses the existing __setBudgetReserverForTests injection point (the
 * same seam already used by deadline-contour.test.ts) rather than
 * experimental module mocking, so a real processObservation() call
 * drives the real SIS and enrichment code paths, with a global.fetch
 * spy proving Groq is never actually contacted once the gate refuses.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  __setBudgetReserverForTests,
  AITokenBudgetExceededError,
} from '../../../lib/ai/budget-gate'
import { processObservation } from '../engine'
import type { ObservationRow } from '@/modules/observations/queries'

function makeObservation(): ObservationRow {
  return {
    id: 'obs-budget-test',
    source_id: 'source-1',
    title: 'A Genuinely Substantive AI Research Observation About Model Training',
    content:
      'Researchers describe a new training technique that improves sample efficiency ' +
      'for large language models, with benchmark results across several standard tasks. ' +
      'The approach avoids the common failure modes of prior methods.',
    url: 'https://example.com/paper',
    published_at: '2026-08-08T00:00:00Z',
    collected_at: '2026-08-08T00:00:00Z',
    metadata: {},
    processed: false,
    processing_error: null,
    signal_id: null,
  } as unknown as ObservationRow
}

function budgetRefusal(): AITokenBudgetExceededError {
  return new AITokenBudgetExceededError(
    '[budget] signal_engine refused for llama-3.3-70b-versatile: reserve_exhausted',
    'llama-3.3-70b-versatile',
    'signal_engine',
    { allowed: false, usedTokens: 100_000, ceilingTokens: 100_000, reason: 'reserve_exhausted' },
  )
}

describe('processObservation propagates AITokenBudgetExceededError (not swallowed)', () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env['GROQ_API_KEY']
  let restoreBudget: (() => void) | undefined
  let fetchCalls: number

  beforeEach(() => {
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    fetchCalls = 0
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      // processObservation touches Supabase directly for deduplication
      // and knowledge-graph ingestion BEFORE it ever reaches an AI
      // stage (checkDuplicate has no try/catch around its own await --
      // a genuine network failure there throws uncaught, unrelated to
      // anything this file tests). Stubbed here with an empty, valid
      // REST response so those calls succeed cleanly and execution
      // actually reaches the SIS/enrichment stages this file exists to
      // test, rather than failing earlier for an unrelated reason.
      if (urlStr.includes('supabase.co') || urlStr.includes('placeholder.supabase')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      fetchCalls++
      // Should never actually be reached for the Groq call in these
      // tests -- present only so a regression that DOES call Groq is
      // visible as a real (successful) network attempt rather than an
      // undefined fetch crash masking the real assertion.
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { total_tokens: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
  })

  afterEach(() => {
    restoreBudget?.()
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env['GROQ_API_KEY']
    else process.env['GROQ_API_KEY'] = originalKey
  })

  test('SIS stage: budget refusal propagates out of processObservation, Groq is never called', async () => {
    restoreBudget = __setBudgetReserverForTests(async () => {
      throw budgetRefusal()
    })

    await assert.rejects(
      processObservation(makeObservation(), 0.8, 'Test Source', '', Date.now() + 120_000),
      (err: unknown) => err instanceof AITokenBudgetExceededError,
      'processObservation must reject with AITokenBudgetExceededError, not swallow it and proceed',
    )
    assert.equal(fetchCalls, 0, 'Groq must never be contacted once the budget gate refuses')
  })

  test('enrichment stage: budget refusal propagates when SIS succeeds but enrichment is refused', async () => {
    let call = 0
    restoreBudget = __setBudgetReserverForTests(async () => {
      call++
      // Let the SIS (classifier) reservation through; refuse on the
      // enrichment (parser) stage's reservation. Since real fetch would
      // also need to succeed for SIS in this scenario, this test uses a
      // real fetch stub that returns a valid SIS payload, then confirms
      // the SECOND stage's refusal still propagates rather than being
      // caught by enrichment's own catch block.
      if (call === 1) return
      throw budgetRefusal()
    })

    let sisAnswered = false
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (urlStr.includes('supabase.co') || urlStr.includes('placeholder.supabase')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      fetchCalls++
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        messages?: Array<{ content: string }>
      }
      const isSisCall = (body.messages ?? []).some((m) =>
        m.content?.includes('AIscentra Intelligence Analyst'),
      )
      if (isSisCall && !sisAnswered) {
        sisAnswered = true
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    novelty: 5,
                    importance: 5,
                    urgency: 5,
                    confidence: 80,
                    human_relevance: true,
                  }),
                },
              },
            ],
            usage: { total_tokens: 50 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(
        'enrichment fetch should never be reached -- the budget gate must refuse first',
      )
    }) as typeof fetch

    await assert.rejects(
      processObservation(makeObservation(), 0.8, 'Test Source', '', Date.now() + 120_000),
      (err: unknown) => err instanceof AITokenBudgetExceededError,
      'the enrichment stage refusal must propagate out of processObservation, not become outcome:"error"',
    )
  })
})
