/**
 * AIscentra — deterministic pre-filter tests
 *
 * REAL BUG this guards: baseline (5) === threshold (5) meant an
 * observation with ZERO keyword matches (neither positive nor
 * negative) passed by DEFAULT -- the filter was effectively a weak
 * negative-only screen, not a genuine positive-evidence requirement.
 * Confirmed via architectural review, re-derived arithmetic, and fixed
 * so passing requires real positive signal, not merely the absence of
 * a few negative phrases.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { computeDeterministicPreScore, checkPreFilter, PRE_FILTER_MIN } from '../pre-qualification'

describe('computeDeterministicPreScore — the real fix', () => {
  test('completely generic content with ZERO keyword matches now correctly FAILS by default', () => {
    const score = computeDeterministicPreScore(
      'Some Generic Headline About Nothing In Particular',
      'This is some ordinary text that does not mention any specific event.',
    )
    assert.ok(
      score < PRE_FILTER_MIN,
      `zero-signal content must score below the threshold by default (got ${score}, threshold ${PRE_FILTER_MIN}) -- previously this passed by default, the exact bug this closes`,
    )
  })

  test('a SINGLE positive term is still not enough on its own', () => {
    const score = computeDeterministicPreScore(
      'Company Announcement',
      'The company had a release today.',
    )
    assert.ok(
      score < PRE_FILTER_MIN,
      `one weak positive signal must not be sufficient alone (got ${score}, threshold ${PRE_FILTER_MIN})`,
    )
  })

  test('two distinct positive terms clear the threshold -- genuine multi-signal newsworthiness', () => {
    const score = computeDeterministicPreScore(
      'OpenAI Launches New Model, Sets Benchmark Record',
      'The company launched a new state-of-the-art model that surpasses previous benchmark scores.',
    )
    assert.ok(score >= PRE_FILTER_MIN, `genuine multi-signal content must pass (got ${score})`)
  })

  test('a single negative term is decisive -- drives the score well below threshold', () => {
    const score = computeDeterministicPreScore(
      'A Survey of Recent Techniques',
      'In this article, we survey of the field.',
    )
    assert.ok(
      score < PRE_FILTER_MIN - 1,
      `a negative term must be a decisive rejection signal (got ${score})`,
    )
  })

  test('score is clamped to [0, 10], never negative or unbounded', () => {
    const veryNegative = computeDeterministicPreScore(
      'Tutorial: A Survey of Best Practices',
      'In this post we review of a tutorial roundup covering weekly digest tips and tricks and an ultimate guide, week in review, how to get started, an overview of best practices, and an introduction to getting started.',
    )
    assert.equal(veryNegative, 0)
  })
})

describe('checkPreFilter', () => {
  test('genuinely newsworthy content passes and reports its real score', () => {
    const result = checkPreFilter({
      title: 'Anthropic Unveils New Model, Achieves Record Benchmark',
      content:
        'Anthropic launched a new model today, achieving state-of-the-art results that surpass prior benchmarks.',
    })
    assert.equal(result.passed, true)
    assert.ok(result.score >= PRE_FILTER_MIN)
  })

  test('generic, low-signal content is now correctly rejected by default -- the real fix', () => {
    const result = checkPreFilter({
      title: 'A Quick Update',
      content: 'Just a short note about ongoing work with no specific event described.',
    })
    assert.equal(
      result.passed,
      false,
      'previously, content like this passed by default since baseline equaled threshold -- the exact bug this fix closes',
    )
  })
})
