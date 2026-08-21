import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildSignalQualityAudit,
  isSignalQualityApproved,
  planLegacySignalQuality,
} from '../quality'
import { checkPromotionEligibility } from '@/modules/events/promotion'
import { processSignalIntoEvent } from '@/modules/events/engine'
import { generateSignalBrief } from '@/modules/reports/engine'
import type { Signal } from '@/types/database'

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'quality-test-signal',
    title: 'Quality foundation test Signal',
    description: 'A deterministic test Signal used for quality-foundation guard tests.',
    category: 'MODELS',
    status: 'ACTIVE',
    impact_factor: 8,
    actor_factor: 8,
    novelty_factor: 8,
    verifiability_factor: 8,
    strategic_factor: 8,
    authority_factor: 8,
    corroboration_factor: 8,
    specificity_factor: 8,
    category_confidence_factor: 8,
    consistency_factor: 8,
    signal_score: 80,
    confidence_score: 80,
    momentum_score: 50,
    intelligence_type: 'SIGNAL',
    qualification_score: 8,
    qualification_detail: {},
    sis_novelty: 8,
    sis_importance: 8,
    sis_urgency: 8,
    sis_confidence: 8,
    sis_final: 8,
    relevance_horizon: 'MONTHS',
    relevance_detail: {},
    anti_hype_score: 8,
    anti_hype_flags: {},
    human_relevance_flags: {},
    lifecycle_state: 'ACTIVE',
    dormant_reason: null,
    reactivate_after: null,
    quality_state: 'APPROVED',
    quality_reason_codes: [],
    quality_rule_version: 'quality-foundation-v1',
    quality_evaluated_at: new Date().toISOString(),
    quarantined_at: null,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: ['obs-1', 'obs-2'],
    entity_ids: [],
    metadata: {},
    engine_version: 'v2.0',
    momentum_last_calculated: null,
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1_000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('Quality Foundation typed contract', () => {
  test('legacy weak/terminal statuses quarantine while all other statuses remain pending', () => {
    for (const [status, reason] of [
      ['WEAK', 'LEGACY_STATUS_WEAK'],
      ['DORMANT', 'LEGACY_STATUS_DORMANT'],
      ['EXPIRED', 'LEGACY_STATUS_EXPIRED'],
      ['REJECTED', 'LEGACY_STATUS_REJECTED'],
    ] as const) {
      assert.deepEqual(planLegacySignalQuality(status), {
        state: 'QUARANTINED',
        reasonCodes: [reason],
      })
    }

    for (const status of ['CANDIDATE', 'DRAFT', 'ACTIVE', 'PROMOTED'] as const) {
      assert.deepEqual(planLegacySignalQuality(status), {
        state: 'PENDING',
        reasonCodes: ['AWAITING_QUALITY_REVIEW'],
      })
    }
  })

  test('dry run never manufactures approvals and reports exact reason totals', () => {
    const report = buildSignalQualityAudit([
      { status: 'ACTIVE' },
      { status: 'PROMOTED' },
      { status: 'WEAK' },
      { status: 'REJECTED' },
    ])

    assert.deepEqual(report, {
      total: 4,
      approved: 0,
      pending: 2,
      quarantined: 2,
      reasonCodes: {
        AWAITING_QUALITY_REVIEW: 2,
        LEGACY_STATUS_WEAK: 1,
        LEGACY_STATUS_REJECTED: 1,
      },
      ruleVersion: 'quality-foundation-v1',
    })
  })

  test('only the explicit APPROVED state passes the typed guard', () => {
    assert.equal(isSignalQualityApproved(makeSignal()), true)
    assert.equal(isSignalQualityApproved(makeSignal({ quality_state: 'PENDING' })), false)
    assert.equal(isSignalQualityApproved(makeSignal({ quality_state: 'QUARANTINED' })), false)
  })
})

describe('Event/Report/Forecast promotion guards', () => {
  test('event eligibility rejects PENDING before all legacy score checks', () => {
    const result = checkPromotionEligibility(makeSignal({ quality_state: 'PENDING' }))
    assert.equal(result.eligible, false)
    assert.match(result.reason, /not APPROVED/)
  })

  test('direct Event engine invocation fails before AI/database work for PENDING', async () => {
    const result = await processSignalIntoEvent(
      makeSignal({ quality_state: 'PENDING' }),
      Date.now() + 1_000,
    )
    assert.equal(result.outcome, 'error')
    assert.match(result.reason ?? '', /APPROVED is required/)
  })

  test('direct Report generation produces no draft or AI work for PENDING', async () => {
    const result = await generateSignalBrief(
      makeSignal({ quality_state: 'PENDING' }),
      Date.now() + 1_000,
    )
    assert.equal(result.outcome, 'skipped')
    assert.match(result.reason ?? '', /APPROVED is required/)
  })
})

describe('Quality Foundation migrations', () => {
  const foundation = readFileSync(
    resolve('supabase/migrations/20260821023045_add_signal_quality_foundation.sql'),
    'utf8',
  )
  const backfill = readFileSync(
    resolve('supabase/migrations/20260821023058_backfill_signal_quality_quarantine.sql'),
    'utf8',
  )

  test('foundation is additive, internal-ledger RLS is enabled, and public Signal RLS is untouched', () => {
    assert.match(foundation, /CREATE TYPE public\.signal_quality_state/i)
    assert.match(
      foundation,
      /ALTER TABLE public\.signal_quality_decisions ENABLE ROW LEVEL SECURITY/i,
    )
    assert.match(
      foundation,
      /REVOKE ALL ON TABLE public\.signal_quality_decisions FROM PUBLIC, anon, authenticated/i,
    )
    assert.match(foundation, /signals_quality_approved_v2_invariants_check/i)
    assert.match(foundation, /events_require_quality_approved_signal_on_insert/i)
    assert.match(foundation, /reports_require_quality_approved_evidence_on_insert/i)
    assert.doesNotMatch(foundation, /DROP POLICY|CREATE POLICY|ALTER POLICY/i)
  })

  test('APPROVED rejects NULL in every required evidence, score, and verification field', () => {
    const approvedConstraint =
      foundation.match(
        /ADD CONSTRAINT signals_quality_approved_v2_invariants_check CHECK \([\s\S]*?\n  \);/i,
      )?.[0] ?? ''

    assert.match(approvedConstraint, /\) IS TRUE/)
    for (const requiredCondition of [
      /status IN \('ACTIVE', 'PROMOTED'\)/,
      /intelligence_type IN \('SIGNAL', 'CRITICAL_SIGNAL'\)/,
      /has_verified_source = TRUE/,
      /verification_state IN \('CORROBORATED', 'VERIFIED'\)/,
      /qualification_score >= 6\.0/,
      /sis_final >= 6\.0/,
      /anti_hype_score >= 3\.0/,
      /cardinality\(validation_flags\) = 0/,
      /cardinality\(observation_ids\) >= 2/,
      /quality_rule_version <> ''/,
    ]) {
      assert.match(approvedConstraint, requiredCondition)
    }
  })

  test('published Report rejects NULL or empty signal_ids', () => {
    const reportGuard =
      foundation.match(
        /CREATE OR REPLACE FUNCTION public\.enforce_quality_approved_report_publication\(\)[\s\S]*?\n\$\$;/i,
      )?.[0] ?? ''

    assert.match(reportGuard, /COALESCE\(cardinality\(NEW\.signal_ids\), 0\) = 0/)
    assert.match(reportGuard, /required_signal_id IS NULL/)
    assert.match(reportGuard, /s\.quality_state IS DISTINCT FROM 'APPROVED'/)
  })

  test('approved signal-only Report remains allowed while NULL or dangling Event references reject', () => {
    const reportGuard =
      foundation.match(
        /CREATE OR REPLACE FUNCTION public\.enforce_quality_approved_report_publication\(\)[\s\S]*?\n\$\$;/i,
      )?.[0] ?? ''

    assert.match(reportGuard, /IF NEW\.event_ids IS NULL THEN/)
    assert.match(reportGuard, /FROM unnest\(NEW\.event_ids\) AS required_event_id/)
    assert.doesNotMatch(reportGuard, /cardinality\(NEW\.event_ids\)[\s\S]*?RAISE EXCEPTION/)
    assert.match(reportGuard, /required_event_id IS NULL/)
    assert.match(reportGuard, /e\.id IS NULL/)
    assert.match(reportGuard, /s\.id IS NULL/)
    assert.match(reportGuard, /s\.quality_state IS DISTINCT FROM 'APPROVED'/)
  })

  test('backfill preserves rows/lifecycle and has no automatic APPROVED assignment', () => {
    const updateStatement = backfill.match(/UPDATE public\.signals[\s\S]*?;/i)?.[0] ?? ''
    assert.match(updateStatement, /'QUARANTINED'/)
    assert.match(updateStatement, /'PENDING'/)
    assert.doesNotMatch(updateStatement, /'APPROVED'/)
    assert.doesNotMatch(backfill, /DELETE FROM public\.signals|TRUNCATE public\.signals/i)
    assert.doesNotMatch(updateStatement, /SET\s+status\s*=/i)
  })
})
