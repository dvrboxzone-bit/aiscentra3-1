/**
 * AIscentra — priority-backfill retry/decision logic
 *
 * Real gap this closes (independent review, PR #46, iteration 2): the
 * production-release.yml `priority-backfill` job needs to make a
 * sequence of AWAITED POST calls to /api/cron/verify-urls until
 * `priorityQueueExhausted: true` is genuinely confirmed, bounded by a
 * real overall timeout and a max-attempts limit, failing the release
 * outright on: a lock-contention response counted too many times, a
 * malformed/incomplete response, writeFailures > 0, gateWriteFailures
 * > 0, or exhausting the attempt/time budget without confirmation.
 *
 * This decision logic is extracted into its own, real, testable pure
 * function -- matching the same pattern already used successfully in
 * this project for domain-cutover.ts's own pure check functions --
 * rather than being embedded directly in bash, where none of these
 * branches could be exercised by a real, deterministic test. The
 * actual HTTP call remains in the workflow's own bash step (via
 * `vercel curl`, matching every other call in that workflow); this
 * module only decides what a given parsed response means and what to
 * do next, and is invoked from that bash step via a small Node
 * wrapper (see the workflow YAML itself for the exact invocation).
 */

export type BackfillDecision =
  | { action: 'success'; reason: string }
  | { action: 'retry'; reason: string }
  | { action: 'fail'; reason: string }

export interface BackfillAttemptState {
  attempt: number
  maxAttempts: number
  elapsedMs: number
  maxElapsedMs: number
}

/**
 * Decides what to do after ONE real POST /api/cron/verify-urls call,
 * given its parsed JSON response (or null if the response was not
 * valid JSON at all) and the current attempt/time state.
 *
 * Real requirement, exactly as specified: skipped/lock-contention is
 * retryable a bounded number of times, but is NEVER itself treated as
 * success. priorityQueueExhausted !== true fails the release (after
 * exhausting retries). writeFailures > 0 or gateWriteFailures > 0 fail
 * the release outright, even if priorityQueueExhausted is true --
 * "errors are never counted as success" applies here exactly as it
 * does inside the endpoint itself.
 */
export function decideBackfillAction(
  httpStatus: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedBody: any,
  state: BackfillAttemptState,
): BackfillDecision {
  // Real fail-closed parsing: any of these malformed-response cases
  // fail the release outright rather than being silently treated as
  // "must be fine" -- an incomplete or unparseable response proves
  // nothing about the real state of the backfill.
  if (parsedBody === null || typeof parsedBody !== 'object') {
    return { action: 'fail', reason: `response is not valid JSON (HTTP ${httpStatus})` }
  }

  if (httpStatus === 401) {
    return { action: 'fail', reason: 'unauthorized (CRON_SECRET mismatch) -- not retryable' }
  }

  if (httpStatus === 500 || 'error' in parsedBody) {
    return {
      action: 'fail',
      reason: `backend reported a genuine error (HTTP ${httpStatus}): ${parsedBody.error ?? 'unknown'}`,
    }
  }

  if (parsedBody.skipped === true) {
    // Lock contention -- another invocation is already running. Real
    // requirement: retryable a BOUNDED number of times, but never
    // itself counted as success.
    if (state.attempt >= state.maxAttempts) {
      return {
        action: 'fail',
        reason: `lock contention persisted for ${state.attempt} attempts -- giving up`,
      }
    }
    if (state.elapsedMs >= state.maxElapsedMs) {
      return {
        action: 'fail',
        reason: 'lock contention persisted past the overall time budget -- giving up',
      }
    }
    return { action: 'retry', reason: 'endpoint reported skipped (lock contention) -- retrying' }
  }

  if (httpStatus !== 200) {
    return { action: 'fail', reason: `unexpected HTTP status ${httpStatus}` }
  }

  // From here on, a genuinely-received, non-error, non-skipped 200
  // response -- validate its shape and content honestly.
  if (typeof parsedBody.priorityQueueExhausted !== 'boolean') {
    return {
      action: 'fail',
      reason: 'response is missing the required priorityQueueExhausted field',
    }
  }
  if (
    typeof parsedBody.writeFailures !== 'number' ||
    typeof parsedBody.gateWriteFailures !== 'number'
  ) {
    return {
      action: 'fail',
      reason: 'response is missing required writeFailures/gateWriteFailures fields',
    }
  }

  if (parsedBody.writeFailures > 0) {
    return {
      action: 'fail',
      reason: `writeFailures=${parsedBody.writeFailures} -- a write error is never success`,
    }
  }
  if (parsedBody.gateWriteFailures > 0) {
    return {
      action: 'fail',
      reason: `gateWriteFailures=${parsedBody.gateWriteFailures} -- a gate-recompute error is never success`,
    }
  }

  if (parsedBody.priorityQueueExhausted === true) {
    return {
      action: 'success',
      reason: 'priority queue genuinely confirmed exhausted, zero write/gate failures',
    }
  }

  // priorityQueueExhausted === false -- genuinely not done yet. Retry
  // if budget remains, otherwise fail the release (per the explicit
  // "Если очередь не завершена в пределах лимита — release
  // блокируется" requirement).
  if (state.attempt >= state.maxAttempts) {
    return {
      action: 'fail',
      reason: `priority queue not exhausted after ${state.attempt} attempts -- exceeding max-attempts, blocking release`,
    }
  }
  if (state.elapsedMs >= state.maxElapsedMs) {
    return {
      action: 'fail',
      reason: 'priority queue not exhausted within the overall time budget -- blocking release',
    }
  }
  return { action: 'retry', reason: 'priority queue not yet exhausted -- retrying' }
}
