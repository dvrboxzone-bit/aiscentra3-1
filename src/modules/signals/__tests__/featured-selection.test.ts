/**
 * AIscentra — Featured Signal Selection Tests
 *
 * Covers: tier fallback-fill cascade, the <40 exclusion, the <5
 * combined-strong+signal condition that pulls in Weak, newest-first
 * ordering within a tier, the soft category-diversity constraint (and
 * its relaxation when honoring it would drop real signals), and the
 * <3-total placeholder condition.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { selectFeaturedSignals, FEATURED_TARGET_COUNT } from '../featured-selection'
import type { Signal } from '@/types/database'

let counter = 0

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  counter += 1
  return {
    id: overrides.id ?? `sig-${counter}`,
    title: 'Test Signal',
    description: 'Test description.',
    category: 'RESEARCH',
    status: 'ACTIVE',
    impact_factor: 5,
    actor_factor: 5,
    novelty_factor: 5,
    verifiability_factor: 5,
    strategic_factor: 5,
    authority_factor: 5,
    corroboration_factor: 5,
    specificity_factor: 5,
    category_confidence_factor: 5,
    consistency_factor: 5,
    signal_score: 70,
    confidence_score: 70,
    momentum_score: 50,
    intelligence_type: 'WEAK_SIGNAL',
    qualification_score: null,
    qualification_detail: {},
    sis_novelty: null,
    sis_importance: null,
    sis_urgency: null,
    sis_confidence: null,
    sis_final: null,
    relevance_horizon: null,
    relevance_detail: {},
    anti_hype_score: null,
    anti_hype_flags: {},
    human_relevance_flags: {},
    lifecycle_state: 'ACTIVE',
    dormant_reason: null,
    reactivate_after: null,
    quality_state: 'APPROVED',
    quality_reason_codes: [],
    quality_rule_version: 'quality-foundation-v1',
    quality_evaluated_at: '2026-01-01T00:00:00Z',
    quarantined_at: null,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: [],
    entity_ids: [],
    metadata: {},
    engine_version: 'v2.0',
    momentum_last_calculated: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function withDate(daysAgo: number, overrides: Partial<Signal> = {}): Signal {
  const d = new Date('2026-08-01T00:00:00Z')
  d.setDate(d.getDate() - daysAgo)
  return makeSignal({ created_at: d.toISOString(), ...overrides })
}

describe('selectFeaturedSignals', () => {
  test('fewer than 3 qualifying signals -> empty (caller renders placeholder)', () => {
    const signals = [withDate(1, { signal_score: 70 }), withDate(2, { signal_score: 65 })]
    assert.deepEqual(selectFeaturedSignals(signals), [])
  })

  test('signals scoring below 40 are never included, even if that leaves fewer than 3', () => {
    const signals = [
      withDate(1, { signal_score: 39 }),
      withDate(2, { signal_score: 20 }),
      withDate(3, { signal_score: 10 }),
    ]
    assert.deepEqual(selectFeaturedSignals(signals), [])
  })

  test('Strong tier (81-100) fills first, newest first within the tier', () => {
    const s1 = withDate(5, { id: 'strong-old', signal_score: 90 })
    const s2 = withDate(1, { id: 'strong-new', signal_score: 95 })
    const s3 = withDate(3, { id: 'strong-mid', signal_score: 85 })
    // Only 3 signals in Strong+Signal combined (< 5), so the weak-tier
    // filler is correctly included too, appended after the Strong tier.
    const weakFiller = withDate(0, { id: 'weak', signal_score: 45 })
    const result = selectFeaturedSignals([s1, s2, s3, weakFiller])
    assert.deepEqual(
      result.map((s) => s.id),
      ['strong-new', 'strong-mid', 'strong-old', 'weak'],
    )
  })

  test('Signal tier (61-80) fills after Strong when Strong alone is not enough', () => {
    const strong = [withDate(1, { signal_score: 85 }), withDate(2, { signal_score: 82 })]
    const mid = [
      withDate(3, { signal_score: 70 }),
      withDate(4, { signal_score: 65 }),
      withDate(5, { signal_score: 61 }),
    ]
    const result = selectFeaturedSignals([...strong, ...mid])
    assert.equal(result.length, 5)
    assert.ok(result.slice(0, 2).every((s) => s.signal_score >= 81))
    assert.ok(result.slice(2).every((s) => s.signal_score >= 61 && s.signal_score < 81))
  })

  test('Weak tier (41-60) only included when combined Strong+Signal count is below 5', () => {
    // Exactly 5 in Strong+Signal combined -> Weak must NOT appear even if present.
    const strongPlusSignal = [
      withDate(1, { signal_score: 85 }),
      withDate(2, { signal_score: 82 }),
      withDate(3, { signal_score: 75 }),
      withDate(4, { signal_score: 65 }),
      withDate(5, { signal_score: 61 }),
    ]
    const weak = withDate(6, { signal_score: 50 })
    const result = selectFeaturedSignals([...strongPlusSignal, weak])
    assert.equal(
      result.some((s) => s.signal_score < 61),
      false,
      'weak-tier signal must not appear when Strong+Signal already reached 5',
    )
  })

  test('Weak tier IS included when combined Strong+Signal count is below 5', () => {
    const strongPlusSignal = [withDate(1, { signal_score: 85 }), withDate(2, { signal_score: 70 })]
    const weak = [withDate(3, { signal_score: 55 }), withDate(4, { signal_score: 45 })]
    const result = selectFeaturedSignals([...strongPlusSignal, ...weak])
    assert.ok(result.some((s) => s.signal_score >= 41 && s.signal_score < 61))
  })

  test('absolute tier order: Strong always fully precedes Signal, even when diversity would prefer otherwise', () => {
    // All 3 Strong signals share one category (MODELS) -- diversity
    // alone would want to interleave a different-category Signal-tier
    // signal to break up the run, but tier order must win: all 3
    // Strong signals must appear before any Signal-tier signal, even
    // though the 3rd Strong signal is same-category as the 1st and 2nd.
    const strong = [
      withDate(1, { id: 'strong-1', category: 'MODELS', signal_score: 95 }),
      withDate(2, { id: 'strong-2', category: 'MODELS', signal_score: 90 }),
      withDate(3, { id: 'strong-3', category: 'MODELS', signal_score: 85 }),
    ]
    const signalTier = [
      withDate(4, { id: 'mid-1', category: 'RESEARCH', signal_score: 75 }),
      withDate(5, { id: 'mid-2', category: 'REGULATION', signal_score: 65 }),
      withDate(6, { id: 'mid-3', category: 'COMPANIES', signal_score: 61 }),
    ]
    const result = selectFeaturedSignals([...strong, ...signalTier])
    assert.deepEqual(
      result.map((s) => s.id),
      ['strong-1', 'strong-2', 'strong-3', 'mid-1', 'mid-2', 'mid-3'],
      'all Strong-tier signals must precede all Signal-tier signals regardless of category repetition',
    )
  })

  test('a signal scoring exactly 40 is excluded (Weak tier starts at 41)', () => {
    const signals = [
      withDate(1, { signal_score: 41 }),
      withDate(2, { signal_score: 40 }),
      withDate(3, { signal_score: 45 }),
      withDate(4, { signal_score: 50 }),
    ]
    const result = selectFeaturedSignals(signals)
    assert.equal(result.length, 3, 'only the 3 signals scoring >=41 qualify')
    assert.equal(
      result.some((s) => s.signal_score === 40),
      false,
      'a signal scoring exactly 40 must never be included',
    )
  })

  test('category diversity: no more than 2 consecutive signals from the same category', () => {
    const signals = [
      withDate(1, { category: 'MODELS', signal_score: 91 }),
      withDate(2, { category: 'MODELS', signal_score: 90 }),
      withDate(3, { category: 'MODELS', signal_score: 89 }),
      withDate(4, { category: 'RESEARCH', signal_score: 88 }),
      withDate(5, { category: 'MODELS', signal_score: 87 }),
      withDate(6, { category: 'RESEARCH', signal_score: 86 }),
    ]
    const result = selectFeaturedSignals(signals)
    for (let i = 0; i + 2 < result.length; i++) {
      const window = result.slice(i, i + 3)
      const allSameCategory = window.every((s) => s.category === window[0]?.category)
      assert.equal(allSameCategory, false, `positions ${i}-${i + 2} are all the same category`)
    }
  })

  test('category diversity is relaxed rather than dropping real signals when no alternative exists', () => {
    // Only MODELS signals available -- the 2-in-a-row constraint cannot
    // be honored without losing content, so it must be relaxed instead.
    const signals = Array.from({ length: 5 }, (_, i) =>
      withDate(i, { category: 'MODELS', signal_score: 90 - i, id: `models-${i}` }),
    )
    const result = selectFeaturedSignals(signals)
    assert.equal(
      result.length,
      5,
      'all real signals must still appear despite lacking category diversity',
    )
  })

  test('respects a custom targetCount', () => {
    const signals = Array.from({ length: 10 }, (_, i) => withDate(i, { signal_score: 70 - i }))
    const result = selectFeaturedSignals(signals, 3)
    assert.equal(result.length, 3)
  })

  test('default target count is 6', () => {
    assert.equal(FEATURED_TARGET_COUNT, 6)
  })
})
