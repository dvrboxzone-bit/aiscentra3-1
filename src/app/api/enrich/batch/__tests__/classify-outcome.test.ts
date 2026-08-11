/**
 * AIscentra — enrich/batch: classifyOutcome tests
 *
 * Real production incident this closes: pipeline_metrics recorded a
 * WEAK signal creation (a genuine success) as a processing failure.
 * The earlier classification only explicitly recognized
 * outcome==='signal_created' as success and any outcome starting with
 * 'rejected' as a rejection -- every OTHER real SignalEngineResult
 * outcome value ('weak_signal_created', 'corroborated_
 * existing_signal', 'archived_prefilter', 'archived_observation')
 * silently fell into the generic error bucket, directly contradicting
 * what the decision log itself recorded for the same event.
 *
 * This test exhaustively covers all 12 real outcome values the type
 * allows (SignalEngineResult['outcome'] in engine.ts), asserting each
 * one lands in the category that genuinely matches what it represents
 * in the decision log -- not merely that the function returns SOME
 * value.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { classifyOutcome } from '../route'
import type { SignalEngineResult } from '@/modules/signals/engine'

describe('classifyOutcome — every real outcome value matches its true decision-log meaning', () => {
  const cases: Array<{
    outcome: SignalEngineResult['outcome']
    expected: 'succeeded' | 'rejected' | 'failed'
  }> = [
    { outcome: 'signal_created', expected: 'succeeded' },
    { outcome: 'weak_signal_created', expected: 'succeeded' },
    { outcome: 'corroborated_existing_signal', expected: 'succeeded' },
    { outcome: 'archived_prefilter', expected: 'rejected' },
    { outcome: 'archived_observation', expected: 'rejected' },
    { outcome: 'rejected_duplicate', expected: 'rejected' },
    { outcome: 'rejected_marketing', expected: 'rejected' },
    { outcome: 'rejected_hard_rule', expected: 'rejected' },
    { outcome: 'rejected_low_sis', expected: 'rejected' },
    { outcome: 'rejected_validation', expected: 'rejected' },
    { outcome: 'rejected_low_score', expected: 'rejected' },
    { outcome: 'error', expected: 'failed' },
  ]

  for (const { outcome, expected } of cases) {
    test(`'${outcome}' classifies as '${expected}'`, () => {
      assert.equal(classifyOutcome(outcome), expected)
    })
  }

  test('the real incident case: weak_signal_created must be "succeeded", NOT counted as a failure', () => {
    // This is the exact real production bug: a WEAK signal creation is
    // a genuine, correct Signal Engine decision -- the decision log
    // records it as a real outcome, not an error. The prior
    // classification's `else` branch silently counted it as a
    // failure, directly contradicting the decision log for the same
    // event.
    assert.equal(
      classifyOutcome('weak_signal_created'),
      'succeeded',
      'a weak signal creation is a real success and must never be recorded as a processing failure',
    )
  })

  test('archived_prefilter is a legitimate REJECTION, not an error -- distinguishes intentional decisions from genuine failures', () => {
    assert.equal(classifyOutcome('archived_prefilter'), 'rejected')
  })

  test('corroborated_existing_signal is a genuine SUCCESS (source diversification), not an error', () => {
    assert.equal(classifyOutcome('corroborated_existing_signal'), 'succeeded')
  })

  test('all 12 real outcome values are covered -- exhaustiveness is enforced at compile time via the `never` default case in classifyOutcome itself', () => {
    // This test exists to document the guarantee, not to re-verify it
    // (TypeScript's own compiler already enforces it): if
    // SignalEngineResult['outcome'] in engine.ts ever grows a 13th
    // member, classifyOutcome fails to type-check until that new
    // outcome is explicitly classified -- a new outcome can never
    // silently fall through to a wrong bucket the way
    // weak_signal_created and archived_prefilter previously did.
    const allOutcomes: SignalEngineResult['outcome'][] = [
      'signal_created',
      'weak_signal_created',
      'corroborated_existing_signal',
      'archived_prefilter',
      'rejected_duplicate',
      'rejected_marketing',
      'rejected_hard_rule',
      'rejected_low_sis',
      'rejected_validation',
      'rejected_low_score',
      'archived_observation',
      'error',
    ]
    assert.equal(allOutcomes.length, 12, 'sanity check: this list must match the real type exactly')
    for (const outcome of allOutcomes) {
      assert.doesNotThrow(() => classifyOutcome(outcome))
    }
  })
})
