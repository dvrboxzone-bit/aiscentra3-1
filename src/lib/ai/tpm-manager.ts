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
// Real bugs fixed here (found in review of the initial deadline-contour
// PR, before this queue had ever been exercised under real contention):
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
// 4. Map entries were never cleaned up -- every distinct model string
//    ever passed in (including the fresh, random ones used in this
//    file's own tests) accumulated in `modelQueues` indefinitely.

const modelQueues = new Map<string, Promise<void>>()

export async function withModelQueue<T>(
  model: string,
  fn: () => Promise<T>,
  deadlineAt: number,
): Promise<T> {
  const prevTail = modelQueues.get(model) ?? Promise.resolve()

  // This caller's own completion signal, used by whoever queues up
  // next for this model. Resolves ONLY once the real work that ends up
  // running (see below) actually finishes -- success or failure --
  // regardless of whether THIS caller itself gives up early on its own
  // deadline while waiting. That is what guarantees strict one-at-a-
  // time execution even across a timed-out waiter: the next caller in
  // line must never start while a still-in-flight previous fn() is
  // running, and must never wait on a promise nothing will ever
  // resolve.
  let markDone!: () => void
  const myTail = new Promise<void>((r) => {
    markDone = r
  })
  modelQueues.set(model, myTail)

  // Wait for the previous holder's turn to end, bounded by THIS
  // caller's own deadline -- an earlier queued caller's (possibly
  // longer) deadline must never force this caller to wait past its own
  // budget.
  let queueWaitTimedOut = false
  await Promise.race([
    prevTail,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        queueWaitTimedOut = true
        resolve()
      }, msUntilDeadline(deadlineAt))
    }),
  ])

  if (queueWaitTimedOut) {
    // Give up now -- this caller's own deadline is gone before it ever
    // got a turn. Forward completion to whoever queues up after us once
    // the ACTUAL previous work finishes (not now) -- prevTail is the
    // real predecessor's completion signal, and the invariant "only one
    // fn() runs per model at a time" depends on the next caller still
    // waiting for that, not for this early exit.
    prevTail.then(markDone, markDone)
    throw new AIDeadlineExceededError(
      `[deadline] withModelQueue:${model}: gave up waiting for the model queue`,
      `withModelQueue:${model}:queue-wait`,
      deadlineAt,
    )
  }

  ensureTimeLeft(deadlineAt, 1_000, `withModelQueue:${model}:post-queue-wait`)
  try {
    return await fn()
  } finally {
    markDone()
    // Clean up: if nobody has queued up behind us since we registered
    // myTail, remove this model's entry entirely rather than leaving a
    // permanently-resolved promise (and the model's string key) in the
    // map forever.
    if (modelQueues.get(model) === myTail) {
      modelQueues.delete(model)
    }
  }
}
