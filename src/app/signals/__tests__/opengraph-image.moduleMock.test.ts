/**
 * AIscentra — /signals/[slug]/opengraph-image regression test
 *
 * REAL PRODUCTION INCIDENT this closes: the endpoint returned HTTP 200
 * with content-type: image/png, but a genuinely EMPTY (0-byte) body.
 * Root cause confirmed in the actual source: the container
 * `AISCENTRA — {formatCategory(...)}` has two child nodes (a literal
 * text node plus an interpolated expression) but no explicit `display`
 * on its own style object -- Satori (the JSX->SVG->PNG engine behind
 * next/og's ImageResponse) requires an explicit `display` on any node
 * with multiple children, and silently produces a runtime error
 * ("Expected <div> to have explicit display...") that results in an
 * empty response body rather than a thrown, visible exception.
 *
 * Uses node:test's real mock.module() (Node 22, --experimental-test-
 * module-mocks) to substitute getSignalById with a controlled, schema-
 * valid Signal fixture -- avoids needing a real Next.js request context
 * for next/headers' cookies() (which the real Supabase server client
 * requires), while still exercising the REAL SignalOGImage function and
 * the REAL next/og ImageResponse/Satori rendering pipeline end to end.
 */
import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { Signal } from '@/types/database'

const VALID_SIGNAL_FIXTURE: Signal = {
  id: 'test-signal-og-1',
  title: 'New Model Release Achieves Record Benchmark Results',
  description: 'A real, schema-valid signal fixture for OG-image regression testing.',
  category: 'MODELS',
  status: 'ACTIVE',
  impact_factor: 7,
  actor_factor: 6,
  novelty_factor: 8,
  verifiability_factor: 7,
  strategic_factor: 6,
  authority_factor: 7,
  corroboration_factor: 5,
  specificity_factor: 6,
  category_confidence_factor: 8,
  consistency_factor: 7,
  signal_score: 67,
  confidence_score: 72,
  momentum_score: 0,
  intelligence_type: 'SIGNAL',
  qualification_score: 67,
  qualification_detail: {},
  sis_novelty: 7,
  sis_importance: 6,
  sis_urgency: 5,
  sis_confidence: 8,
  sis_final: 65,
  relevance_horizon: 'MONTHS',
  relevance_detail: {},
  anti_hype_score: 6,
  anti_hype_flags: {},
  human_relevance_flags: {},
  lifecycle_state: 'ACTIVE',
  dormant_reason: null,
  reactivate_after: null,
  validation_flags: [],
  manual_override: false,
  expiration_reason: null,
  expired_at: null,
  observation_ids: [],
  entity_ids: [],
  metadata: {},
  engine_version: 'v2',
  momentum_last_calculated: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
}

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')

describe('SignalOGImage regression: empty-body Satori display fix', () => {
  test('a real, schema-valid Signal fixture produces a genuinely non-empty PNG response, not the real 0-byte production incident', async (t) => {
    const m = mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignalById: async (id: string) =>
          id === VALID_SIGNAL_FIXTURE.id ? VALID_SIGNAL_FIXTURE : null,
      },
    })
    t.after(() => m.restore())

    const { default: SignalOGImage } = await import('../[slug]/opengraph-image')
    const response = await SignalOGImage({
      params: Promise.resolve({ slug: VALID_SIGNAL_FIXTURE.id }),
    })

    assert.equal(
      response.headers.get('content-type'),
      'image/png',
      'the real production incident kept this header correct even while the body was empty -- confirming this check ALONE would not have caught the regression',
    )

    const arrayBuffer = await response.arrayBuffer()
    const body = Buffer.from(arrayBuffer)

    assert.ok(
      body.byteLength > 0,
      `the response body must be genuinely non-empty -- the real production incident returned exactly 0 bytes here, got ${body.byteLength}`,
    )
    assert.deepEqual(
      body.subarray(0, 8),
      PNG_SIGNATURE,
      'the response body must start with the real PNG signature (89504e470d0a1a0a) -- proves this is a genuinely decodable image, not merely a non-empty buffer of unrelated bytes',
    )
  })
})
