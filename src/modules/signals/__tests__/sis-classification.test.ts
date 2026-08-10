/**
 * AIscentra — SIS classification boundary tests
 *
 * REAL BUG this guards: classifyBySIS() returns FOUR values ('SIGNAL' |
 * 'WEAK_SIGNAL' | 'ARCHIVE' | 'DISCARD'), but engine.ts's own
 * ACTIVE-vs-WEAK decision previously checked only `=== 'WEAK_SIGNAL'`,
 * silently letting 'ARCHIVE'-tier scores (2.0-3.99) fall through to
 * ACTIVE. Confirmed against production: ACTIVE signals existed with SIS
 * 2.20-3.90.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { classifyBySIS } from '@/types/database'
import { isWeakSignalDecision } from '../engine'

describe('classifyBySIS boundaries', () => {
  test('>= 6.0 classifies as SIGNAL', () => {
    assert.equal(classifyBySIS(6.0), 'SIGNAL')
    assert.equal(classifyBySIS(9.5), 'SIGNAL')
  })

  test('4.0-5.99 classifies as WEAK_SIGNAL', () => {
    assert.equal(classifyBySIS(4.0), 'WEAK_SIGNAL')
    assert.equal(classifyBySIS(5.99), 'WEAK_SIGNAL')
  })

  test('2.0-3.99 classifies as ARCHIVE -- the band the original bug missed', () => {
    assert.equal(classifyBySIS(2.0), 'ARCHIVE')
    assert.equal(classifyBySIS(2.2), 'ARCHIVE', 'exact production value observed as wrongly-ACTIVE')
    assert.equal(classifyBySIS(3.9), 'ARCHIVE', 'exact production value observed as wrongly-ACTIVE')
    assert.equal(classifyBySIS(3.99), 'ARCHIVE')
  })

  test('< 2.0 classifies as DISCARD', () => {
    assert.equal(classifyBySIS(1.99), 'DISCARD')
    assert.equal(classifyBySIS(0), 'DISCARD')
  })
})

describe('isWeakSignalDecision (the actual fix)', () => {
  test('SIGNAL decision is NOT weak -- becomes ACTIVE', () => {
    assert.equal(isWeakSignalDecision('SIGNAL', 80), false)
  })

  test('WEAK_SIGNAL decision IS weak', () => {
    assert.equal(isWeakSignalDecision('WEAK_SIGNAL', 80), true)
  })

  test('ARCHIVE decision IS weak -- this is the exact regression test for the bug', () => {
    assert.equal(
      isWeakSignalDecision('ARCHIVE', 80),
      true,
      'an ARCHIVE-tier SIS score must never fall through to ACTIVE regardless of signal_score',
    )
  })

  test('undefined SIS (unavailable) falls back to the V1 signal_score < 55 threshold, unchanged behavior', () => {
    assert.equal(isWeakSignalDecision(undefined, 54), true)
    assert.equal(isWeakSignalDecision(undefined, 55), false)
    assert.equal(isWeakSignalDecision(undefined, 90), false)
  })
})
