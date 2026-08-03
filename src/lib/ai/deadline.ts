/**
 * AIscentra — AI Call Deadline
 *
 * A single, absolute deadline (epoch ms) is created ONCE in
 * enrich/batch/route.ts and threaded through the entire AI call chain:
 *
 *   enrich/batch → processObservation → agentCompleteJSON → withRetry
 *     → withModelQueue → waitForTPMBudget → callProvider (fetch)
 *
 * Real incident this fixes: enrich/batch's own TIME_BUDGET (54s) check
 * only ran BETWEEN observations, and only checked "do I have >=8s left
 * before STARTING the next one" -- it had no way to stop an
 * already-in-flight call. agent.ts's retry/backoff logic (MAX_RETRIES=3,
 * meaning 4 attempts with backoff between them: 5s/10s/20s, capped at
 * 60s per wait) had zero awareness of any outer time budget. Corrected
 * math (an earlier version of this comment overstated this at "75+
 * seconds" by incorrectly including a 4th, non-existent wait after the
 * final attempt): a single model's backoff alone totals 5+10+20=35s
 * (there is no wait after the last of the 4 attempts). A role with a
 * 2-model fallback chain (e.g. classifier: MINI then PRIMARY) could
 * therefore spend up to ~70s on backoff alone across both models for
 * ONE AI call. processObservation makes up to two such AI calls per
 * observation (the SIS classifier stage, then the main
 * enrichment/parser stage) -- so, worst case, backoff alone could
 * reach roughly 140s for a single observation before ever throwing --
 * confirmed live via Vercel's own runtime error log: "Task timed out
 * after 60 seconds" on /api/enrich/batch, recurring since 2026-07-28.
 * A single stalled observation could consume the ENTIRE remaining
 * budget and take the whole batch (and every other queued observation
 * in that invocation) down with it when Vercel force-killed the
 * function -- no requeue, no controlled response, nothing recorded.
 * Already-processed and already-signal-created observations from
 * earlier in the same batch run are not lost by this failure mode --
 * each observation is marked processed (or requeued) individually as
 * it completes, before the next one starts; only the one in-flight
 * observation at the moment of the force-kill, and any not yet
 * attempted in that invocation, were affected.
 *
 * Every layer in the chain now checks the SAME deadline before doing
 * any work that could block for a meaningful amount of time (a retry
 * attempt, a fallback model, a backoff sleep, a TPM-budget wait), and
 * the actual outbound fetch() carries a real AbortSignal tied to the
 * same deadline -- a bare `Promise.race` around a fetch does not
 * cancel the underlying HTTP request or free the connection; only an
 * AbortSignal passed into fetch() itself does that.
 */

/**
 * Thrown whenever any layer determines that continuing (another retry
 * attempt, a fallback model, a backoff sleep, a TPM wait, or the
 * outbound HTTP request itself) would not finish before the shared
 * deadline. This is always a TEMPORARY condition -- the same
 * observation should be requeued for a later run, never marked as a
 * permanent processing_error. Deliberately NOT an AIProviderError
 * subclass: this is not a provider-side failure, it is this project's
 * own time-budget enforcement, and callers must be able to tell the
 * two apart without inspecting statusCode.
 */
export class AIDeadlineExceededError extends Error {
  constructor(
    message: string,
    public readonly context: string,
    public readonly deadlineAt: number,
    public readonly now: number = Date.now(),
  ) {
    super(message)
    this.name = 'AI_DEADLINE_EXCEEDED'
  }
}

/**
 * Throws AIDeadlineExceededError if fewer than `minMs` milliseconds
 * remain before `deadlineAt`. Called before every retry attempt,
 * fallback-model attempt, backoff sleep, and TPM wait in the chain --
 * `context` identifies exactly which check point tripped, for
 * diagnosability (this project has already paid the cost of opaque
 * "something timed out somewhere" failures once; not repeating that).
 */
export function ensureTimeLeft(deadlineAt: number, minMs: number, context: string): void {
  const remaining = deadlineAt - Date.now()
  if (remaining < minMs) {
    throw new AIDeadlineExceededError(
      `[deadline] ${context}: ${remaining}ms remaining, needed >=${minMs}ms`,
      context,
      deadlineAt,
    )
  }
}

/** Milliseconds remaining until the deadline, floored at 0. */
export function msUntilDeadline(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now())
}

/**
 * A sleep that never oversleeps past the deadline -- if the requested
 * delay would cross it, throws AIDeadlineExceededError immediately
 * instead of sleeping for a doomed duration and failing later anyway.
 */
export async function sleepWithDeadline(
  ms: number,
  deadlineAt: number,
  context: string,
): Promise<void> {
  ensureTimeLeft(deadlineAt, ms, context)
  await new Promise((r) => setTimeout(r, ms))
}
