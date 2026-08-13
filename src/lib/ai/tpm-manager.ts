/**
 * AIscentra — TPM Budget Manager
 *
 * Prevents 429 rate_limit_exceeded by tracking token consumption
 * and enforcing per-minute budget before each LLM request.
 *
 * Groq limits (Free Tier):
 *   llama-3.1-8b-instant:   6,000 TPM
 *   llama-3.3-70b-versatile: 12,000 TPM
 *
 * Architecture:
 * - Token window: rolling 60-second window per model
 * - Before each request: check if estimated tokens fit in remaining budget
 * - If not: wait until window resets
 * - Sequential queue: one request at a time per model (no parallel calls)
 *
 * Both the TPM wait and the sequential queue below are threaded with
 * the shared AI-call deadline (see ./deadline.ts) -- neither may wait
 * past it. A previous version of this file had no deadline awareness
 * at all, letting a single stalled or heavily rate-limited call
 * silently consume the caller's entire remaining time budget.
 */
import {
  ensureTimeLeft,
  sleepWithDeadline,
  msUntilDeadline,
  AIDeadlineExceededError,
} from './deadline'

/**
 * Thrown when a request's estimated token cost EXCEEDS the target
 * model's own entire safety-margined TPM budget -- not merely the
 * currently-remaining slice of it. Distinct from AIDeadlineExceededError
 * and AITokenBudgetExceededError (this project's other two dedicated,
 * non-provider error types) so callers can tell "this specific model
 * can never serve a request this large, no amount of waiting will
 * help" apart from a genuine deadline or daily-budget refusal.
 * REAL PRODUCTION INCIDENT this exists for: see fitsWithinModelTPM's
 * own docstring below.
 */
export class AIRequestTooLargeError extends Error {
  constructor(
    message: string,
    public readonly model: string,
    public readonly estimatedTokens: number,
    public readonly modelCeiling: number,
  ) {
    super(message)
    this.name = 'AI_REQUEST_TOO_LARGE'
  }
}

// ── TPM limits per model ──────────────────────────────────────────────────────

const TPM_LIMITS: Record<string, number> = {
  'llama-3.1-8b-instant': 6_000,
  'llama-3.3-70b-versatile': 12_000,
  default: 6_000, // conservative fallback
}

const SAFETY_MARGIN = 0.85 // use only 85% of limit to avoid edge cases

// ── Token window tracking ─────────────────────────────────────────────────────

interface TokenEntry {
  timestamp: number // ms
  tokens: number
}

const tokenWindows = new Map<string, TokenEntry[]>()

function getWindowedTokens(model: string): number {
  const now = Date.now()
  const cutoff = now - 60_000 // 60 second rolling window
  const entries = (tokenWindows.get(model) ?? []).filter((e) => e.timestamp > cutoff)
  tokenWindows.set(model, entries)
  return entries.reduce((sum, e) => sum + e.tokens, 0)
}

function recordTokens(model: string, tokens: number): void {
  const entries = tokenWindows.get(model) ?? []
  entries.push({ timestamp: Date.now(), tokens })
  tokenWindows.set(model, entries)
}

function getOldestEntry(model: string): TokenEntry | undefined {
  const entries = tokenWindows.get(model) ?? []
  return entries.reduce(
    (oldest, e) => (!oldest || e.timestamp < oldest.timestamp ? e : oldest),
    undefined as TokenEntry | undefined,
  )
}

// ── Budget check ──────────────────────────────────────────────────────────────

export interface BudgetCheckResult {
  allowed: boolean
  usedTokens: number
  limitTokens: number
  remainingTokens: number
  waitMs: number // how long to wait if not allowed
}

export function checkTPMBudget(model: string, estimatedTokens: number): BudgetCheckResult {
  const defaultLimit = TPM_LIMITS['default']
  if (defaultLimit === undefined) {
    throw new Error("Invariant violated: TPM_LIMITS is missing its required 'default' entry.")
  }
  const limit = (TPM_LIMITS[model] ?? defaultLimit) * SAFETY_MARGIN
  const used = getWindowedTokens(model)
  const remaining = Math.max(0, limit - used)
  const allowed = estimatedTokens <= remaining

  let waitMs = 0
  if (!allowed) {
    // Wait until oldest entry expires from window
    const oldest = getOldestEntry(model)
    if (oldest) {
      waitMs = Math.max(0, oldest.timestamp + 60_000 - Date.now()) + 500
    } else {
      waitMs = 5_000
    }
  }

  return {
    allowed,
    usedTokens: Math.round(used),
    limitTokens: Math.round(limit),
    remainingTokens: Math.round(remaining),
    waitMs,
  }
}

/**
 * REAL PRODUCTION INCIDENT this closes: three genuine Groq 429s on the
 * model-chain fallback to llama-3.1-8b-instant (TPM 6,000), each with
 * a "Requested" size (5,137-5,144 tokens) that exceeds the model's
 * ENTIRE safety-margined per-minute budget (6,000 * 0.85 = 5,100) --
 * not merely the currently-remaining slice of it. checkTPMBudget's own
 * `allowed` field only ever reflects "does this fit in what's left
 * THIS minute" -- for a request this large, `allowed` would be false
 * regardless of usedTokens, and waitForTPMBudget would loop,
 * repeatedly waiting for the rolling window to clear, FOREVER
 * reporting "not yet allowed," since no amount of waiting can make an
 * intrinsically-too-large request fit inside a limit smaller than
 * itself. Root cause traced to a model-chain fallback (see
 * agentComplete in agent.ts) sending the SAME full-size prompt built
 * for a higher-TPM primary model to a much lower-TPM fallback model,
 * with no check that the fallback model's own ceiling could ever
 * physically accommodate it.
 *
 * This function answers a genuinely different question from
 * checkTPMBudget: not "is there room RIGHT NOW," but "could this
 * request EVER fit, even in a completely empty window." Called BEFORE
 * any TPM wait is attempted -- a caller that gets `false` here must
 * refuse the call immediately (never attempt the provider, never
 * enter a wait loop that can only time out or loop forever) and
 * requeue the underlying work instead, exactly as an oversized-for-
 * this-model request that would otherwise surface as a real Groq 429
 * (or an infinite/very long TPM wait) should be handled.
 */
export interface ModelCeilingCheck {
  fits: boolean
  modelCeiling: number
}

export function fitsWithinModelTPM(model: string, estimatedTokens: number): ModelCeilingCheck {
  const defaultLimit = TPM_LIMITS['default']
  if (defaultLimit === undefined) {
    throw new Error("Invariant violated: TPM_LIMITS is missing its required 'default' entry.")
  }
  const absoluteCeiling = (TPM_LIMITS[model] ?? defaultLimit) * SAFETY_MARGIN
  return { fits: estimatedTokens <= absoluteCeiling, modelCeiling: Math.round(absoluteCeiling) }
}

// ── Wait for budget ───────────────────────────────────────────────────────────

export async function waitForTPMBudget(
  model: string,
  estimatedTokens: number,
  deadlineAt: number,
  maxWaitMs: number = 120_000,
): Promise<void> {
  const start = Date.now()

  while (true) {
    const check = checkTPMBudget(model, estimatedTokens)
    if (check.allowed) return

    ensureTimeLeft(deadlineAt, check.waitMs, `waitForTPMBudget:${model}`)

    if (Date.now() - start > maxWaitMs) {
      console.warn(`[tpm-manager] Max wait exceeded for ${model}, proceeding anyway`)
      return
    }

    console.info(
      `[tpm-manager] TPM budget: ${check.usedTokens}/${check.limitTokens} used. Waiting ${check.waitMs}ms for ${model}`,
    )
    await sleepWithDeadline(check.waitMs, deadlineAt, `waitForTPMBudget:${model}`)
  }
}

// ── Record actual token usage ─────────────────────────────────────────────────

export function recordActualTokens(model: string, inputTokens: number, outputTokens: number): void {
  recordTokens(model, inputTokens + outputTokens)
}

// ── Sequential queue per model ────────────────────────────────────────────────
// Ensures only one request at a time per model — prevents burst parallel calls
//
// Real bugs fixed here across two review passes (found before this
// queue had ever been exercised under real contention):
//
// 1. The wait for the previous holder's turn had NO deadline bound at
//    all -- a caller with a short remaining budget would wait for
//    however long an EARLIER caller's (possibly much longer) deadline
//    allowed, rather than giving up on its own.
// 2. If a waiting caller's OWN deadline expired while it was waiting,
//    it threw -- but never called its own `resolve()`, because that
//    only happened in the try/finally around fn(), which was never
//    reached. Every LATER caller queued behind it would then wait on a
//    promise that could never resolve, deadlocking the entire queue for
//    that model forever.
// 3. There was no explicit guarantee that a timed-out waiter's early
//    exit could not let some later caller start running concurrently
//    with the actual still-in-flight previous fn() -- correctness here
//    requires forwarding the queue's "done" signal to the true
//    predecessor's completion, not to whichever caller happened to give
//    up first.
// 4. Map entries were never cleaned up.
// 5. (Second pass) The SAME "never releases" bug as #2 also existed on
//    the "ready" path: `ensureTimeLeft(...post-queue-wait)` ran BEFORE
//    the try/finally that calls markDone(), so if the previous holder
//    finished but this caller's OWN remaining time was then too short
//    (e.g. the previous holder released at T, this caller's own
//    deadline is at T+100ms, needing >=1000ms), that check's throw
//    escaped without ever releasing myTail -- deadlocking every later
//    caller exactly like bug #2, just reached via a different path.
//    Fixed by moving ensureTimeLeft inside the try block, so the SAME
//    finally that guarantees release on a real fn() failure also
//    guarantees it here.
// 6. The race between "previous holder finished" and "my own deadline
//    hit" was tracked via a captured, later-mutated boolean
//    (`queueWaitTimedOut = true` inside a callback) rather than the
//    Promise.race's own resolved value -- functionally equivalent, but
//    an explicit `'ready' | 'timeout'` result read directly off
//    Promise.race is less error-prone and doesn't leave a dangling
//    setTimeout uncleared when `prevTail` wins the race first (fixed
//    below via clearTimeout).

const modelQueues = new Map<string, Promise<void>>()

type QueueWaitResult = 'ready' | 'timeout'

export async function withModelQueue<T>(
  model: string,
  fn: () => Promise<T>,
  deadlineAt: number,
): Promise<T> {
  const prevTail = modelQueues.get(model) ?? Promise.resolve()

  // This caller's own completion signal, used by whoever queues up
  // next for this model. Resolves ONLY once the real work that ends up
  // running actually finishes -- success or failure -- regardless of
  // whether THIS caller itself gives up early on its own deadline
  // while waiting, or gives up just after waiting due to insufficient
  // remaining time. That is what guarantees strict one-at-a-time
  // execution even across a caller that never runs fn() at all: the
  // next caller in line must never start while a still-in-flight
  // previous fn() is running, and must never wait on a promise nothing
  // will ever resolve.
  let markDone!: () => void
  const myTail = new Promise<void>((r) => {
    markDone = r
  })
  modelQueues.set(model, myTail)

  // Wait for the previous holder's turn to end, bounded by THIS
  // caller's own deadline -- an earlier queued caller's (possibly
  // longer) deadline must never force this caller to wait past its own
  // budget. The race's result is read directly as an explicit
  // 'ready' | 'timeout' value, not inferred from a mutated outer
  // boolean.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutResult: Promise<QueueWaitResult> = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timeout'), msUntilDeadline(deadlineAt))
  })
  const readyResult: Promise<QueueWaitResult> = prevTail.then(() => 'ready' as const)

  const waitResult = await Promise.race([readyResult, timeoutResult])
  clearTimeout(timeoutHandle)

  // Shared release logic, used by BOTH exit paths below: releases this
  // caller's own queue slot (markDone(), unblocking whoever queues up
  // next) AND cleans up the map entry if nobody has registered after
  // us since. Defined once so the 'timeout' path (deferred until the
  // REAL previous holder actually finishes) and the 'ready' path
  // (immediate, in a finally) cannot drift out of sync with each
  // other -- an earlier version of this function only did this
  // cleanup on the 'ready' path, leaving the map entry (and the
  // model's string key) behind forever whenever a caller timed out
  // waiting and was the last one registered when the real predecessor
  // eventually finished.
  const release = (): void => {
    markDone()
    // If a LATER caller has already registered its own tail for this
    // model (queued up after us, even though we gave up), that entry
    // must be left alone -- only remove the map entry if `myTail` is
    // still the current value, proving nobody has queued up since.
    if (modelQueues.get(model) === myTail) {
      modelQueues.delete(model)
    }
  }

  if (waitResult === 'timeout') {
    // Give up now -- this caller's own deadline is gone before it ever
    // got a turn. Release (markDone() + the same cleanup check as the
    // 'ready' path) only once the ACTUAL previous work finishes (not
    // now) -- prevTail is the real predecessor's completion signal,
    // and the invariant "only one fn() runs per model at a time"
    // depends on the next caller still waiting for that, not for this
    // early exit. The queue must never be released before the real
    // previous holder actually completes.
    prevTail.then(release, release)
    throw new AIDeadlineExceededError(
      `[deadline] withModelQueue:${model}: gave up waiting for the model queue`,
      `withModelQueue:${model}:queue-wait`,
      deadlineAt,
    )
  }

  // waitResult === 'ready': prevTail has already resolved, so from here
  // on EVERY exit path -- including ensureTimeLeft throwing below, not
  // just fn() itself failing -- must release myTail, since nothing
  // else will do it for us. Both checks and the actual work live
  // inside the same try/finally specifically so that guarantee holds
  // regardless of WHERE within this block something throws.
  try {
    ensureTimeLeft(deadlineAt, 1_000, `withModelQueue:${model}:post-queue-wait`)
    return await fn()
  } finally {
    release()
  }
}

/**
 * @internal Test-only accessor into this module's private queue state.
 * Never used by production code -- exists solely so a test can confirm
 * a model's `modelQueues` entry was actually cleaned up (not merely
 * that the returned/thrown Promise settled), without exporting the Map
 * itself or otherwise widening this module's real public surface.
 */
export function __hasModelQueueEntryForTests(model: string): boolean {
  return modelQueues.has(model)
}
