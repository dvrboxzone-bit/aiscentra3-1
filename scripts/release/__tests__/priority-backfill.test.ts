/**
 * AIscentra — priority-backfill retry/decision logic tests
 *
 * Real behavioral tests, exactly as required (independent review of
 * PR #46, iteration 2): timeout with an unfinished priority queue,
 * confirmed full exhaustion, lock contention, write/gate failure, and
 * fail-closed parsing of a malformed/incomplete response. (The
 * "successful retry of a recompute after a previous failure" case is
 * covered separately, at the endpoint level, in
 * backfill-logic.test.ts -- this file covers the WORKFLOW-side
 * retry/fail decision, not the endpoint's own reconciliation query.)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { decideBackfillAction, type BackfillAttemptState } from '../priority-backfill'

function state(overrides: Partial<BackfillAttemptState> = {}): BackfillAttemptState {
  return { attempt: 1, maxAttempts: 5, elapsedMs: 0, maxElapsedMs: 300_000, ...overrides }
}

describe('decideBackfillAction — confirmed full exhaustion (success)', () => {
  test('priorityQueueExhausted=true with zero write/gate failures is success', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: true,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state(),
    )
    assert.equal(decision.action, 'success')
  })

  test('a response arriving AFTER the overall deadline is NEVER treated as success, even if priorityQueueExhausted=true -- the real fix, blocker 2.3', () => {
    // Simulates the caller (production-release.yml) recomputing
    // elapsedMs AFTER the response was received: the deadline was
    // already spent by the time this genuinely-exhausted result
    // arrived. A late confirmation must not be honored as success.
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: true,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state({ attempt: 1, maxAttempts: 10, elapsedMs: 300_500, maxElapsedMs: 300_000 }),
    )
    assert.equal(
      decision.action,
      'fail',
      'a genuinely-exhausted result that arrives after the deadline must still block the release, not be honored as success',
    )
  })

  test('a response arriving exactly AT the deadline boundary is treated the same as after it (>=), not as success', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: true,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state({ elapsedMs: 300_000, maxElapsedMs: 300_000 }),
    )
    assert.equal(decision.action, 'fail')
  })

  test('a response arriving comfortably within the deadline, with exhausted=true, is genuinely success', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: true,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state({ elapsedMs: 5_000, maxElapsedMs: 300_000 }),
    )
    assert.equal(decision.action, 'success')
  })
})

describe('decideBackfillAction — timeout with an UNFINISHED priority queue (the real fail-open gap this closes)', () => {
  test('priorityQueueExhausted=false retries while budget remains', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: false,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state({ attempt: 2, maxAttempts: 5, elapsedMs: 10_000, maxElapsedMs: 300_000 }),
    )
    assert.equal(decision.action, 'retry')
  })

  test('priorityQueueExhausted=false after exceeding max-attempts BLOCKS the release, does not pass', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: false,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state({ attempt: 5, maxAttempts: 5 }),
    )
    assert.equal(
      decision.action,
      'fail',
      'an unfinished priority queue must never be treated as acceptable',
    )
  })

  test('priorityQueueExhausted=false after exceeding the overall time budget BLOCKS the release', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: false,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state({ attempt: 1, maxAttempts: 100, elapsedMs: 300_001, maxElapsedMs: 300_000 }),
    )
    assert.equal(decision.action, 'fail')
  })

  test('a real timeout response (HTTP 200, false, but still within budget) is retried, not silently accepted as done -- the EXACT scenario the old stoppedReason overwrite bug masked', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: false,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
        stoppedReason: 'time_budget',
      },
      state({ attempt: 1, maxAttempts: 5, elapsedMs: 1000, maxElapsedMs: 300_000 }),
    )
    assert.equal(
      decision.action,
      'retry',
      'a time_budget stop with an unfinished queue must retry, never be conflated with genuine completion',
    )
  })
})

describe('decideBackfillAction — lock contention (skipped) is retryable but NEVER counted as success', () => {
  test('a skipped response retries while attempts/budget remain', () => {
    const decision = decideBackfillAction(
      200,
      { skipped: true, reason: 'verify_urls_already_running' },
      state(),
    )
    assert.equal(decision.action, 'retry')
  })

  test('a skipped response after exhausting max-attempts fails the release, is never success', () => {
    const decision = decideBackfillAction(
      200,
      { skipped: true },
      state({ attempt: 5, maxAttempts: 5 }),
    )
    assert.equal(decision.action, 'fail')
  })

  test('a skipped response after exhausting the time budget fails the release', () => {
    const decision = decideBackfillAction(
      200,
      { skipped: true },
      state({ elapsedMs: 300_001, maxElapsedMs: 300_000 }),
    )
    assert.equal(decision.action, 'fail')
  })

  test('skipped is NEVER, under any state, itself returned as the success action', () => {
    for (const s of [
      state({ attempt: 1 }),
      state({ attempt: 4, maxAttempts: 5 }),
      state({ elapsedMs: 299_999, maxElapsedMs: 300_000 }),
    ]) {
      const decision = decideBackfillAction(200, { skipped: true }, s)
      assert.notEqual(
        decision.action,
        'success',
        'lock contention must never itself be treated as success',
      )
    }
  })
})

describe('decideBackfillAction — write/gate failures fail the release outright, even with an exhausted queue', () => {
  test('writeFailures > 0 fails, even though priorityQueueExhausted is true', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: true,
        writeFailures: 2,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state(),
    )
    assert.equal(decision.action, 'fail')
    assert.match(decision.reason, /writeFailures/)
  })

  test('gateWriteFailures > 0 fails, even though priorityQueueExhausted is true', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: true,
        writeFailures: 0,
        gateWriteFailures: 1,
        reconciliationFailures: 0,
      },
      state(),
    )
    assert.equal(decision.action, 'fail')
    assert.match(decision.reason, /gateWriteFailures/)
  })

  test('reconciliationFailures > 0 fails, even though priorityQueueExhausted is true and write/gate failures are zero -- real fix, reconciliation was previously best-effort', () => {
    const decision = decideBackfillAction(
      200,
      {
        priorityQueueExhausted: true,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 3,
      },
      state(),
    )
    assert.equal(
      decision.action,
      'fail',
      'a reconciliation read failure must block the release, not be silently treated as clean',
    )
    assert.match(decision.reason, /reconciliationFailures/)
  })

  test('a response missing the reconciliationFailures field entirely fails closed, is not assumed zero', () => {
    const decision = decideBackfillAction(
      200,
      { priorityQueueExhausted: true, writeFailures: 0, gateWriteFailures: 0 },
      state(),
    )
    assert.equal(decision.action, 'fail')
  })
})

describe('decideBackfillAction — fail-closed parsing of a malformed/incomplete/erroring response', () => {
  test('null/non-JSON body fails, not retried indefinitely as if it might resolve itself', () => {
    const decision = decideBackfillAction(200, null, state())
    assert.equal(decision.action, 'fail')
  })

  test('a non-object body (e.g. a bare string or number) fails', () => {
    assert.equal(decideBackfillAction(200, 'not an object', state()).action, 'fail')
    assert.equal(decideBackfillAction(200, 42, state()).action, 'fail')
  })

  test('HTTP 401 (auth failure) fails immediately, is not retried', () => {
    const decision = decideBackfillAction(401, { error: 'Unauthorized' }, state({ attempt: 1 }))
    assert.equal(decision.action, 'fail')
  })

  test("HTTP 500 (the endpoint's own honest db_error response) fails, is never masked as success", () => {
    const decision = decideBackfillAction(
      500,
      { error: 'Database read failed during backfill', priorityQueueExhausted: false },
      state(),
    )
    assert.equal(decision.action, 'fail')
  })

  test('a 200 response missing the required priorityQueueExhausted field fails closed, not assumed true', () => {
    const decision = decideBackfillAction(200, { writeFailures: 0, gateWriteFailures: 0 }, state())
    assert.equal(decision.action, 'fail')
  })

  test('a 200 response missing writeFailures/gateWriteFailures fails closed, not assumed zero', () => {
    const decision = decideBackfillAction(200, { priorityQueueExhausted: true }, state())
    assert.equal(decision.action, 'fail')
  })

  test('an unexpected HTTP status (e.g. 502) with a well-formed body still fails, status is checked independently', () => {
    const decision = decideBackfillAction(
      502,
      {
        priorityQueueExhausted: true,
        writeFailures: 0,
        gateWriteFailures: 0,
        reconciliationFailures: 0,
      },
      state(),
    )
    assert.equal(decision.action, 'fail')
  })
})
