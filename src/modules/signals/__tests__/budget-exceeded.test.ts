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
 * REAL TEST BUG FIXED (independent review): the enrichment-stage test
 * below previously used a SIS fixture with the WRONG field names
 * (novelty/importance/urgency/confidence/human_relevance instead of
 * the real schema's sis_novelty/sis_importance/sis_urgency/
 * sis_confidence/anti_hype_score/engine_justification), and refused
 * the budget reservation by raw call-count (`call === 2`). With the
 * wrong fixture, SIS's own PRIMARY model (8b) attempt failed schema
 * validation on the very first call, forcing SIS's own chain to fall
 * back to its SECONDARY model (70b) -- consuming the "second"
 * reservation call itself. The test still observed
 * AITokenBudgetExceededError propagating (since SIS's own fallback
 * attempt got refused), so it passed -- but for the wrong reason: it
 * never actually exercised the enrichment/parser stage's own
 * reservation at all. Fixed: a genuinely schema-valid SIS fixture
 * (verified via SISOutputSchema.safeParse before trusting it), and the
 * budget reserver mock now refuses based on the REAL `model` argument
 * reserveBudgetForCall receives (openai/gpt-oss-120b, the
 * enrichment/parser stage's own primary model) rather than a raw call
 * counter that can't distinguish which STAGE is actually being
 * charged.
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
import { SISOutputSchema } from '../strategic-score'
import type { ObservationRow } from '@/modules/observations/queries'

function makeObservation(): ObservationRow {
  return {
    id: 'obs-budget-test',
    source_id: 'source-1',
    title: 'New Model Release Achieves Record Benchmark Results',
    content:
      'Researchers describe a new training technique that improves sample efficiency ' +
      'for large language models. The new model release achieves state-of-the-art benchmark ' +
      'results across several standard tasks, outperforming prior methods. ' +
      // Genuinely clears the deterministic pre-filter (checkPreFilter,
      // pre-qualification.ts) with real positive-term matches
      // ("release", "achieves", "benchmark", "state-of-the-art",
      // "outperforming") so this fixture reaches the SIS/enrichment
      // stage this test actually exercises, rather than being archived
      // by the pre-filter before ever reaching it.
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

function budgetRefusal(model: string): AITokenBudgetExceededError {
  return new AITokenBudgetExceededError(
    `[budget] signal_engine refused for ${model}: reserve_exhausted`,
    model,
    'signal_engine',
    { allowed: false, usedTokens: 100_000, ceilingTokens: 100_000, reason: 'reserve_exhausted' },
  )
}

// Genuinely schema-valid SIS payload -- verified via
// SISOutputSchema.safeParse in a dedicated test below, not merely
// assumed. Real field names (sis_ prefix), a genuine
// engine_justification string (required, no default), and every other
// field the schema actually requires.
const VALID_SIS_PAYLOAD = {
  sis_novelty: 5,
  sis_importance: 5,
  sis_urgency: 5,
  sis_confidence: 8,
  human_cto: true,
  anti_hype_score: 5,
  relevance_horizon: 'MONTHS',
  event_type: 'DISCRETE_EVENT',
  engine_justification: 'Genuine benchmark improvement with reproducible results across tasks.',
}

test('sanity: VALID_SIS_PAYLOAD is genuinely schema-valid against the real SISOutputSchema', () => {
  const result = SISOutputSchema.safeParse(VALID_SIS_PAYLOAD)
  assert.equal(
    result.success,
    true,
    result.success
      ? ''
      : JSON.stringify((result as { success: false; error: { issues: unknown } }).error.issues),
  )
})

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
    restoreBudget = __setBudgetReserverForTests(async (params) => {
      throw budgetRefusal(params.model)
    })

    await assert.rejects(
      processObservation(makeObservation(), 0.8, 'Test Source', '', Date.now() + 120_000),
      (err: unknown) => err instanceof AITokenBudgetExceededError,
      'processObservation must reject with AITokenBudgetExceededError, not swallow it and proceed',
    )
    assert.equal(fetchCalls, 0, 'Groq must never be contacted once the budget gate refuses')
  })

  test('enrichment stage: SIS genuinely succeeds (real schema-valid response, no SIS fallback), the ENRICHMENT/parser stage\'s own reservation is refused, and the error propagates out of processObservation rather than becoming outcome:"error"', async () => {
    // Real, model-aware reservation tracking -- not a raw call
    // counter. Every reservation call is recorded with its actual
    // model/consumer arguments so the assertions below can prove
    // EXACTLY which stage was reserved for, in which order, rather
    // than assuming ordinal position.
    const reservations: Array<{ model: string; consumer: string; estimatedTokens: number }> = []
    restoreBudget = __setBudgetReserverForTests(async (params) => {
      reservations.push({
        model: params.model,
        consumer: params.consumer,
        estimatedTokens: params.estimatedTokens,
      })
      // Refuse specifically the ENRICHMENT/parser stage's own primary
      // model (70b) -- SIS's own primary model (8b) must be let
      // through so SIS genuinely completes first.
      if (params.model === 'openai/gpt-oss-120b') {
        throw budgetRefusal(params.model)
      }
    })

    let sisCalls = 0
    let enrichmentCalls = 0
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (urlStr.includes('supabase.co') || urlStr.includes('placeholder.supabase')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      fetchCalls++
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        model?: string
        messages?: Array<{ content: string }>
      }
      const isSisCall = (body.messages ?? []).some((m) =>
        m.content?.includes('AIscentra Intelligence Analyst'),
      )
      if (isSisCall) {
        sisCalls++
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(VALID_SIS_PAYLOAD) } }],
            usage: { total_tokens: 50 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      // Any real fetch to the enrichment stage's own model would only
      // happen if the budget refusal above did NOT stop execution
      // before reaching the provider -- must never happen.
      enrichmentCalls++
      throw new Error(
        'enrichment fetch should never be reached -- the budget gate must refuse first',
      )
    }) as typeof fetch

    await assert.rejects(
      processObservation(makeObservation(), 0.8, 'Test Source', '', Date.now() + 120_000),
      (err: unknown) => err instanceof AITokenBudgetExceededError,
      'the enrichment stage refusal must propagate out of processObservation, not become outcome:"error"',
    )

    assert.equal(
      sisCalls,
      1,
      'SIS must succeed on its own FIRST attempt -- no SIS-stage fallback to a second model',
    )
    assert.equal(
      enrichmentCalls,
      0,
      "the enrichment stage's real Groq fetch must never happen once its reservation is refused",
    )

    // Prove the REAL reservation sequence: SIS's own model reserved
    // and allowed first, THEN enrichment's own model reserved and
    // refused -- using the actual recorded arguments, not an assumed
    // call count.
    assert.ok(
      reservations.length >= 2,
      `expected at least 2 reservation calls, got ${reservations.length}`,
    )
    assert.equal(
      reservations[0]?.model,
      'openai/gpt-oss-20b',
      "the FIRST reservation must be for SIS's own primary model (8b)",
    )
    assert.equal(reservations[0]?.consumer, 'signal_engine')
    const enrichmentReservation = reservations.find((r) => r.model === 'openai/gpt-oss-120b')
    assert.ok(
      enrichmentReservation,
      "a reservation for the enrichment stage's own model (70b) must have been attempted",
    )
    assert.equal(enrichmentReservation?.consumer, 'signal_engine')
  })
})
