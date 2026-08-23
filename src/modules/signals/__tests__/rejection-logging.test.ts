/**
 * AIscentra — signal rejection logging regression tests
 * (independent-review fix, 2026-08-23)
 *
 * REAL DIAGNOSTIC FINDING this closes: three rejection paths inside
 * processObservation (is_marketing, is_duplicate, validateSignal
 * failure) previously returned WITHOUT writing anything to either
 * signal_decision_log or the observation's own qualification_result/
 * rejection_code/rejection_reason -- a genuinely successful AI
 * enrichment call landing on any of these three outcomes left ZERO
 * trace anywhere in the database. Confirmed via live production data
 * (2026-08-23): 6 genuinely successful Groq SIS+enrichment call pairs
 * with zero corresponding signal_decision_log entries and zero new
 * signals -- statistically near-impossible against the real historical
 * base rate (147 WEAK_SIGNAL + 103 SIGNAL out of 257 total real SIS
 * decisions, i.e. ~97.3%), yet unfalsifiable without this fix since
 * the real reason was being silently discarded before it could ever
 * be persisted.
 *
 * Same real fetch-interception test harness as merge-blockers.test.ts/
 * budget-exceeded.test.ts: processObservation runs its REAL code path
 * end to end, Supabase writes are observed by their real REST shape
 * (POST/PATCH against /observations and /signal_decision_log), not
 * inferred from the function's own return value alone.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { processObservation } from '../engine'
import type { ObservationRow } from '@/modules/observations/queries'

function makeObservation(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: 'obs-rejection-logging-test',
    source_id: 'source-1',
    title: 'New Model Release Achieves Record Benchmark Results',
    content:
      'Researchers describe a new training technique that improves sample efficiency ' +
      'for large language models. The new model release achieves state-of-the-art benchmark ' +
      'results across several standard tasks, outperforming prior methods.',
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

const BASE_ENRICHMENT_PAYLOAD = {
  title: 'New Model Release Achieves Record Benchmark Results',
  description:
    'A new training technique improves sample efficiency for large language models, ' +
    'achieving state-of-the-art benchmark results across several standard tasks.',
  category: 'MODELS',
  impact_factor: 6,
  actor_factor: 6,
  novelty_factor: 6,
  verifiability_factor: 6,
  strategic_factor: 6,
  authority_factor: 6,
  corroboration_factor: 6,
  specificity_factor: 6,
  category_confidence_factor: 6,
  entities: [{ name: 'Example Lab', type: 'ORGANIZATION' }],
  is_duplicate: false,
  duplicate_note: null,
  is_marketing: false,
  novelty_prior_example: null,
}

/**
 * Sets up the real fetch-interception harness: Supabase calls are
 * observed and recorded (never actually reach a real database), SIS
 * always succeeds with VALID_SIS_PAYLOAD, enrichment succeeds with
 * whatever real payload the caller supplies (so each test can force a
 * specific real rejection path via is_marketing/is_duplicate, or an
 * invalid title/description to force validateSignal to fail).
 */
function installHarness(enrichmentPayload: Record<string, unknown>): {
  observationUpdates: Array<{ body: unknown }>
  decisionLogInserts: Array<{ body: unknown }>
  restore: () => void
} {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env['GROQ_API_KEY']
  process.env['GROQ_API_KEY'] = 'test-key-not-real'

  const observationUpdates: Array<{ body: unknown }> = []
  const decisionLogInserts: Array<{ body: unknown }> = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString()
    if (urlStr.includes('supabase.co') || urlStr.includes('placeholder.supabase')) {
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = init?.body ? JSON.parse(init.body as string) : null
      if (urlStr.includes('/observations') && method === 'PATCH') {
        observationUpdates.push({ body })
      }
      if (urlStr.includes('/signal_decision_log') && method === 'POST') {
        decisionLogInserts.push({ body })
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const body = JSON.parse((init?.body as string) ?? '{}') as {
      model?: string
      messages?: Array<{ content: string }>
    }
    const isSisCall = (body.messages ?? []).some((m) =>
      m.content?.includes('AIscentra Intelligence Analyst'),
    )
    const payload = isSisCall ? VALID_SIS_PAYLOAD : enrichmentPayload
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  return {
    observationUpdates,
    decisionLogInserts,
    restore: () => {
      globalThis.fetch = originalFetch
      if (originalApiKey === undefined) delete process.env['GROQ_API_KEY']
      else process.env['GROQ_API_KEY'] = originalApiKey
    },
  }
}

describe('processObservation — the three previously-silent rejection paths now genuinely persist their real reason', () => {
  test('is_marketing=true: real R-14 written to BOTH the observation row and signal_decision_log', async () => {
    const { observationUpdates, decisionLogInserts, restore } = installHarness({
      ...BASE_ENRICHMENT_PAYLOAD,
      is_marketing: true,
    })
    try {
      const result = await processObservation(
        makeObservation(),
        0.8,
        'Test Source',
        '',
        Date.now() + 30_000,
      )
      assert.equal(result.outcome, 'rejected_marketing')

      assert.equal(observationUpdates.length, 1, 'exactly one real PATCH to /observations')
      assert.equal(
        (observationUpdates[0]?.body as { rejection_code?: string }).rejection_code,
        'R-14',
      )

      assert.equal(decisionLogInserts.length, 1, 'exactly one real POST to /signal_decision_log')
      const logged = decisionLogInserts[0]?.body as { rejection_code?: string; decision?: string }
      assert.equal(logged.rejection_code, 'R-14')
      assert.equal(logged.decision, 'DISCARD')
    } finally {
      restore()
    }
  })

  test('is_duplicate=true: real R-11 written to BOTH the observation row and signal_decision_log', async () => {
    const { observationUpdates, decisionLogInserts, restore } = installHarness({
      ...BASE_ENRICHMENT_PAYLOAD,
      is_duplicate: true,
      duplicate_note: 'Same story already covered yesterday',
    })
    try {
      const result = await processObservation(
        makeObservation(),
        0.8,
        'Test Source',
        '',
        Date.now() + 30_000,
      )
      assert.equal(result.outcome, 'rejected_duplicate')

      assert.equal(observationUpdates.length, 1, 'exactly one real PATCH to /observations')
      assert.equal(
        (observationUpdates[0]?.body as { rejection_code?: string }).rejection_code,
        'R-11',
      )

      assert.equal(decisionLogInserts.length, 1, 'exactly one real POST to /signal_decision_log')
      const logged = decisionLogInserts[0]?.body as { rejection_code?: string; decision?: string }
      assert.equal(logged.rejection_code, 'R-11')
      assert.equal(logged.decision, 'DISCARD')
    } finally {
      restore()
    }
  })

  test('validateSignal failure (score below threshold): real R-15 written to BOTH the observation row and signal_decision_log', async () => {
    const { observationUpdates, decisionLogInserts, restore } = installHarness({
      ...BASE_ENRICHMENT_PAYLOAD,
      // All factors at the schema's own minimum (0, still passes
      // EnrichmentOutputSchema's own 0-10 range) so signal_score/
      // confidence_score compute below validateSignal's VAL-05/VAL-06
      // real thresholds -- unlike a too-short title, which fails at
      // the EARLIER EnrichmentOutputSchema.title.min(10) check itself
      // (an identical real bound to validateSignal's own VAL-01),
      // never reaching validateSignal at all.
      impact_factor: 0,
      actor_factor: 0,
      novelty_factor: 0,
      verifiability_factor: 0,
      strategic_factor: 0,
      authority_factor: 0,
      corroboration_factor: 0,
      specificity_factor: 0,
      category_confidence_factor: 0,
    })
    try {
      const result = await processObservation(
        makeObservation(),
        0.8,
        'Test Source',
        '',
        Date.now() + 30_000,
      )
      assert.ok(
        result.outcome === 'rejected_validation' || result.outcome === 'rejected_low_score',
        `expected a real validation-failure outcome, got ${result.outcome}`,
      )

      assert.equal(observationUpdates.length, 1, 'exactly one real PATCH to /observations')
      assert.equal(
        (observationUpdates[0]?.body as { rejection_code?: string }).rejection_code,
        'R-15',
      )

      assert.equal(decisionLogInserts.length, 1, 'exactly one real POST to /signal_decision_log')
      const logged = decisionLogInserts[0]?.body as { rejection_code?: string; decision?: string }
      assert.equal(logged.rejection_code, 'R-15')
      assert.equal(logged.decision, 'DISCARD')
    } finally {
      restore()
    }
  })
})
