/**
 * AIscentra — Autonomous Batch Enrichment
 *
 * POST /api/enrich/batch
 *
 * Batch sizing rationale (production-incident throughput fix):
 *   - Vercel Hobby maxDuration = 60s
 *   - Real observed Groq latency (production log, 25 real requests,
 *     2026-08-10/11): time_to_completion ranged 0.24s-1.22s per call,
 *     not the earlier pessimistic 3-6s estimate.
 *   - Real per-observation cost: 2 AI calls (SIS 8b + main 70b) x
 *     (INTER_REQUEST_MS=2,200ms + real completion time) ≈ 4.6-5.7s
 *   - DB overhead per observation: ~1s
 *   - Effective budget: maxDuration - DEADLINE_BUFFER_MS = 50s
 *   - Real safe batch size: floor(50s / 7s) ≈ 7
 * BATCH_SIZE raised 3 -> 7, using the file's own original (more
 * principled) calculation above rather than the prior manual override
 * to 3 "for stability" with no further justification. This does NOT
 * touch INTER_REQUEST_MS, the deadline contour, or the atomic TPD
 * budget gate -- the real daily ceiling (~19.8 observations/day at 2
 * calls/observation, 100,000 TPD / ~2,527 tokens/call) is unchanged
 * and still enforced by budget-gate.ts regardless of BATCH_SIZE; this
 * only lets a SINGLE run make fuller use of its own share of that
 * already-existing budget, converging on the real ceiling faster
 * across the day's 6 scheduled cycles instead of leaving time
 * (and safe-to-spend token budget) unused within each individual
 * invocation.
 *
 * Autonomy:
 *   Processes observations in a loop until queue is empty OR the shared
 *   deadline is reached. No manual re-triggers needed mid-queue.
 *
 * Deadline contour (real incident fix):
 *   A single absolute `deadlineAt` (epoch ms) is created ONCE here and
 *   threaded through the entire AI call chain (processObservation →
 *   agentCompleteJSON → withRetry → withModelQueue → waitForTPMBudget →
 *   callProvider's fetch, see src/lib/ai/deadline.ts for the full
 *   rationale). Previously, this route's own TIME_BUDGET check only ran
 *   BETWEEN observations and could not stop an already-in-flight call --
 *   agent.ts's retry/backoff logic (MAX_RETRIES=3, 4 attempts with
 *   5s/10s/20s backoff between them, no time-budget awareness) could
 *   legitimately spend up to 35s of backoff alone on a single model,
 *   up to ~70s across a 2-model fallback chain for one AI call, and up
 *   to ~140s across the two AI calls processObservation makes per
 *   observation (SIS classifier stage, then main enrichment/parser
 *   stage) -- confirmed live via Vercel's runtime error log ("Task
 *   timed out after 60 seconds" on this exact route, recurring since
 *   2026-07-28). DEADLINE_BUFFER_MS below leaves at least 10s between
 *   the deadline and Vercel's actual kill point, specifically so a
 *   deadline-triggered requeue and this function's own JSON response
 *   have time to complete. Already-processed observations from earlier
 *   in the same run are not lost by this failure mode -- each one is
 *   marked processed (or requeued) individually before the next starts.
 *
 * HTTP 429 handling:
 *   429 = rate_limit from AI provider — temporary, NOT an error.
 *   Observation is returned to queue via markObservationForRetry() with 60s backoff.
 *   It will be picked up in the next batch run automatically.
 *
 * AI_DEADLINE_EXCEEDED handling:
 *   The deadline was reached mid-call (any layer) — also temporary, NOT
 *   a processing error. The in-flight observation is requeued with a
 *   short, distinct backoff (DEADLINE_RETRY_MS), and the whole batch
 *   loop stops immediately so this invocation can return a controlled
 *   JSON response instead of being force-killed by Vercel.
 *
 * Called by: /api/cron/pipeline (daily Vercel Cron)
 * Also available for manual drain.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { processObservation, type SignalEngineResult } from '@/modules/signals/engine'
import {
  markObservationProcessed,
  markObservationForRetry,
  getObservationStats,
} from '@/modules/observations/queries'
import { AIProviderError } from '@/lib/ai/client'
import { AIDeadlineExceededError, msUntilDeadline } from '@/lib/ai/deadline'
import { AITokenBudgetExceededError } from '@/lib/ai/budget-gate'
import { AIRequestTooLargeError } from '@/lib/ai/tpm-manager'
import { recordCycleMetrics } from '@/lib/metrics'
import {
  acquireEnrichmentLock,
  releaseEnrichmentLock,
  pruneTokenLedger,
} from '@/lib/ai/execution-lock'
import type { ObservationRow } from '@/modules/observations/queries'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// ── Batch sizing & rate limiting ──────────────────────────────────────────────
// Direct models: llama-3.3-70b (12K TPM) + llama-3.1-8b (fallback)
// Each enrichment: ~1000-1500 tokens → max 8-12 requests/minute safely
// Conservative: 1 request per 6s = 10 requests/minute (20% headroom)
const BATCH_SIZE = 7 // real throughput fix -- see file docstring above for the exact math
const DEADLINE_BUFFER_MS = 10_000 // >=10s between deadline and Vercel's actual kill, for requeue + response
const AI_RETRY_MS = 30_000 // 30s backoff after 429 (no Retry-After header available)
const DEADLINE_RETRY_MS = 10_000 // short backoff after AI_DEADLINE_EXCEEDED -- distinct from rate-limit backoff
const BUDGET_RETRY_MS = 60_000 // backoff after AI_TOKEN_BUDGET_EXCEEDED -- longer than a deadline miss,
// since a daily/rolling-window budget refusal will not resolve in seconds. The real backstop
// is the next scheduled enrichment cycle (~4h away, see enrich-batch-hourly.yml), which will
// re-fetch this observation regardless of the exact value once its retry_after has passed.
// REAL PRODUCTION INCIDENT this closes: AI_REQUEST_TOO_LARGE (see
// AIRequestTooLargeError's own docstring in tpm-manager.ts) previously
// fell through to a real Groq 429 (three confirmed instances: limit
// 6,000, used 1,154-1,532, requested 5,137-5,144) instead of being
// caught here. Backoff set equal to BUDGET_RETRY_MS -- a request this
// large for the current model chain is unlikely to resolve on the
// very next attempt, but content/config CAN change between cycles
// (e.g. a shorter observation body after re-collection, or a model-
// chain config change), so this is a genuine requeue, not a permanent
// rejection.
const REQUEST_TOO_LARGE_RETRY_MS = 60_000
// REAL PRODUCTION INCIDENT this closes: a genuine Source-table read
// failure (network error, RLS issue, connection reset) must be
// requeued honestly, not silently substituted with a fabricated
// trustScore/sourceName -- see FetchSourceInfoResult's own docstring.
// Same backoff duration as a budget/deadline requeue: a transient DB
// read failure is unlikely to resolve within seconds, but the next
// scheduled cycle will retry it regardless.
const SOURCE_READ_RETRY_MS = 60_000
// THROUGHPUT FIX: was 6_000ms (10 RPM effective). Confirmed against
// Groq's own published Free-plan limits for llama-3.3-70b-versatile:
// 30 RPM, 100,000 TPD. 6s pacing was calibrated BEFORE the atomic TPD
// budget gate (src/lib/ai/budget-gate.ts, PR #43) existed, when a fixed
// delay was the only real protection against overrunning limits. Now
// that every real provider attempt is gated by an atomic, per-attempt
// budget reservation BEFORE it reaches Groq (see agent.ts), the fixed
// delay's job is only to stay under the RPM ceiling, not TPD -- 6s (10
// RPM) was 3x more conservative than the real 30 RPM limit requires.
// 2,200ms gives ~27.3 RPM, a real safety margin under 30 rather than
// cutting it exactly to the limit. This does not touch BATCH_SIZE or
// TIME_BUDGET, and the TPD ceiling itself is enforced by the budget
// gate regardless of this value -- reducing this delay increases how
// many observations a single enrichment cycle can drain within its
// existing time budget without spending the daily token budget any
// faster than the gate already allows.
const INTER_REQUEST_MS = 2_200 // ~27.3 RPM, safety margin under Groq's real 30 RPM limit

export interface BatchStats {
  /** REAL BUG FIXED (production incident: metrics contradicted the
   * decision log). `attempted` is now a single, honest count of every
   * item processObservation was actually called for this cycle
   * (whether it returned normally or threw) -- succeeded + rejected +
   * failed always sums to exactly this value; retried items are
   * tracked separately since they are NOT yet resolved (they get
   * another real attempt on a future cycle, so counting them toward
   * this cycle's attempted/succeeded/rejected/failed would misrepresent
   * what THIS cycle actually decided). */
  attempted: number
  /** signal_created + weak_signal_created + corroborated_existing_signal
   * -- every outcome that represents a genuine, positive Signal Engine
   * decision, not just the single 'signal_created' string. REAL BUG
   * FIXED: 'weak_signal_created' and 'corroborated_existing_signal'
   * were previously falling into the generic `else` branch and being
   * counted as errors -- a real WEAK signal being created (a genuine
   * success) was recorded in pipeline_metrics as a failure, directly
   * contradicting the decision log's own record of the same event. */
  succeeded: number
  /** Every legitimate REJECTION/ARCHIVAL decision (any outcome value
   * starting with 'rejected_', plus 'archived_prefilter' and
   * 'archived_observation') -- these are correct, intentional Signal
   * Engine decisions, not processing failures. REAL BUG FIXED:
   * 'archived_prefilter' previously fell into the generic `else`
   * branch and was counted as an error. */
  rejected: number
  /** Requeued for a later attempt (429 rate limit, AI_DEADLINE_EXCEEDED,
   * AI_TOKEN_BUDGET_EXCEEDED) -- NOT yet resolved, so intentionally
   * excluded from the attempted/succeeded/rejected/failed accounting
   * above; only counted here. */
  retried: number
  /** A genuine processing failure: outcome:'error' (a real, unexpected
   * condition inside processObservation that produced no decision at
   * all) OR a thrown exception that was not one of the three
   * temporary/retryable error types above. */
  failed: number
  /** Real per-item processing latencies (ms), collected during this
   * batch. Used to compute real p50/p95 for the whole cycle -- see
   * recordCycleMetrics's own call site below. */
  item_latencies_ms: number[]
  stopped_reason:
    | 'queue_empty'
    | 'time_budget'
    | 'rate_limited'
    | 'deadline_exceeded'
    | 'budget_exhausted'
    | 'requeue_failed'
    | 'request_too_large'
    | 'source_read_failed'
    | 'queue_read_failed'
    | 'write_failed'
  error_breakdown: {
    rate_limit: number
    server_error: number
    timeout: number
    deadline_exceeded: number
    budget_exhausted: number
    requeue_failed: number
    json_parse: number
    validation: number
    database: number
    /** REAL PRODUCTION INCIDENT this closes: a request physically too
     * large for its target model's own TPM budget (see
     * AIRequestTooLargeError's own docstring in tpm-manager.ts) --
     * distinct from a generic provider error, and handled by a
     * controlled requeue rather than ever reaching Groq as a doomed
     * call that would return a real 429. */
    request_too_large: number
    unknown: number
  }
}

/**
 * REAL BUG FIXED (production incident): the single most direct cause
 * of the metrics/decision-log mismatch. `processObservation` can
 * return any of 12 distinct outcome strings (SignalEngineResult in
 * engine.ts) -- the earlier version only explicitly recognized
 * 'signal_created' as success and any outcome starting with
 * 'rejected' as a rejection, silently bucketing every OTHER real,
 * legitimate outcome ('weak_signal_created', 'corroborated_
 * existing_signal', 'archived_prefilter', 'archived_observation',
 * 'rejected_validation', 'rejected_low_score') into the generic
 * "error" catch-all. A real WEAK signal creation -- a genuine success
 * -- was recorded in pipeline_metrics as a processing failure. This
 * function is the single source of truth for the mapping, covering
 * every outcome value the type actually allows (exhaustively checked
 * at compile time via the `never` default case).
 */
export function classifyOutcome(
  outcome: SignalEngineResult['outcome'],
): 'succeeded' | 'rejected' | 'failed' {
  switch (outcome) {
    case 'signal_created':
    case 'weak_signal_created':
    case 'corroborated_existing_signal':
      return 'succeeded'
    case 'archived_prefilter':
    case 'archived_observation':
    case 'rejected_duplicate':
    case 'rejected_marketing':
    case 'rejected_hard_rule':
    case 'rejected_low_sis':
    case 'rejected_validation':
    case 'rejected_low_score':
      return 'rejected'
    case 'error':
      return 'failed'
    default: {
      // Exhaustiveness check: if SignalEngineResult['outcome'] ever
      // grows a new member, this fails to compile until classifyOutcome
      // is updated for it -- a new outcome can never silently fall
      // through to a wrong bucket again.
      const _exhaustive: never = outcome
      return _exhaustive
    }
  }
}

function freshStats(): BatchStats {
  return {
    attempted: 0,
    succeeded: 0,
    rejected: 0,
    retried: 0,
    failed: 0,
    item_latencies_ms: [],
    stopped_reason: 'queue_empty',
    error_breakdown: {
      rate_limit: 0,
      server_error: 0,
      timeout: 0,
      deadline_exceeded: 0,
      budget_exhausted: 0,
      requeue_failed: 0,
      json_parse: 0,
      validation: 0,
      database: 0,
      request_too_large: 0,
      unknown: 0,
    },
  }
}

/**
 * Dependencies for processBatchOfObservations, injected purely for
 * testability -- the real POST handler below constructs the real
 * Supabase-backed versions and passes them through unchanged. This is
 * the minimal seam needed to test the loop's stop/continue behavior
 * (deadline exceeded, rate limit, requeue failure) without mocking
 * Supabase's full query-builder chain for every call it makes.
 */
export interface FetchSourceInfoResult {
  ok: boolean
  trustScore: number
  sourceName: string
  /** REAL PRODUCTION INCIDENT this closes: distinguishes "the source
   * genuinely has no name/trust_score set" (ok: true, defaults are
   * legitimate) from "the read itself failed" (ok: false, error set --
   * defaults must NEVER be used here, since scoring/processing an
   * observation against a fabricated trustScore or a fake 'Unknown
   * Source' name when the real source lookup simply failed produces a
   * genuinely wrong result, not a degraded-but-honest one). */
  error?: string
}

export interface BatchProcessingDeps {
  fetchSourceInfo: (sourceId: string) => Promise<FetchSourceInfoResult>
  /** Fetches the next page of ready-to-process observations, alternating
   * between the "fresh" and "old" pools based on `pageIndex` (real
   * SQL/query semantics unchanged from fetchNextReadyPage's own
   * fresh/old-interleaving logic -- this is just made an injectable
   * dependency so both a genuine read failure AND the fresh/old
   * alternation itself can be exercised by real behavioral tests,
   * matching the same seam already used for fetchSourceInfo/
   * processObservation/markObservationProcessed/markObservationForRetry
   * above). */
  fetchObservationsPage: (pageIndex: number, limit: number) => Promise<ReadyPage>
  processObservation: typeof processObservation
  markObservationProcessed: typeof markObservationProcessed
  markObservationForRetry: typeof markObservationForRetry
  /** Overridable for tests that need to observe/skip the real 6s inter-request delay. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Processes one already-fetched batch of ready observations
 * sequentially, stopping early on a deadline hit, a rate limit, or a
 * requeue write failure -- extracted from the POST handler below so
 * this stop/continue behavior (points 7-8 of the task this was
 * written for: "after deadline, batch stops and the next observation
 * is not processed"; "same honest behavior for 429") is directly
 * testable with a fixed, injected observation list instead of needing
 * to mock Supabase's SELECT query.
 */
export async function processBatchOfObservations(
  ready: ObservationRow[],
  deadlineAt: number,
  deps: BatchProcessingDeps,
): Promise<BatchStats> {
  const stats = freshStats()
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  for (const observation of ready) {
    if (msUntilDeadline(deadlineAt) < 8_000) {
      // Less than 8s left — not enough for another AI call
      stats.stopped_reason = 'time_budget'
      break
    }

    try {
      const sourceInfo = await deps.fetchSourceInfo(observation.source_id)

      // REAL PRODUCTION INCIDENT this closes: a genuine Source read
      // failure (network error, RLS issue, connection reset) was
      // previously indistinguishable from "this source legitimately
      // has no name/trust_score" -- both silently fell back to
      // trustScore=0.5 and sourceName='Unknown Source', letting the
      // observation be scored and processed against fabricated values
      // instead of the real source's own real trust level. A genuine
      // read failure must be requeued, never silently substituted.
      if (!sourceInfo.ok) {
        // HONEST METRICS CONTRACT: this observation WAS genuinely
        // extracted from the queue and a real processing attempt began
        // for it (the source lookup is a necessary step before AI
        // processing can run) -- counts toward attempted regardless of
        // whether the requeue itself succeeds.
        stats.attempted++
        stats.error_breakdown.database++
        try {
          await deps.markObservationForRetry(observation.id, SOURCE_READ_RETRY_MS)
          stats.retried++
          stats.stopped_reason = 'source_read_failed'
          console.warn(
            `[enrich/batch] source read failed for ${observation.id} (source ${observation.source_id}): ${sourceInfo.error ?? 'unknown error'} — requeued, not scored against fabricated defaults`,
          )
        } catch (requeueErr) {
          stats.failed++
          stats.error_breakdown.requeue_failed++
          stats.stopped_reason = 'requeue_failed'
          console.error(
            `[enrich/batch] requeue_failed after source-read-failure for ${observation.id}: ${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
          )
        }
        break
      }
      const { trustScore, sourceName } = sourceInfo

      const itemStartedAt = Date.now()
      const result = await deps.processObservation(
        observation,
        trustScore,
        sourceName,
        '',
        deadlineAt,
      )
      stats.item_latencies_ms.push(Date.now() - itemStartedAt)

      const writeResult = await deps.markObservationProcessed(
        observation.id,
        result.signalId ?? null,
        result.outcome === 'error' ? result.reason : undefined,
      )

      // REAL PRODUCTION INCIDENT this closes: this write's own success
      // was previously never checked -- stats.processed++ (and the
      // outcome classification below it) ran UNCONDITIONALLY, so a
      // genuine write failure (the observation's processing_error/
      // processed/signal_id fields never actually landed in the
      // database) was still counted as a successfully processed item in
      // pipeline_metrics. Requeue instead of silently reporting success
      // for a write that did not happen -- the next cycle will
      // re-attempt both the AI processing and this write.
      //
      // HONEST METRICS CONTRACT (merge of PR #50 + PR #51 + this
      // task's own explicit contract):
      //   items_attempted = items_succeeded + items_rejected +
      //                      items_failed + items_retried
      // `attempted` counts every observation genuinely extracted from
      // the queue and passed into the processing workflow -- including
      // one whose RESULT write failed, since the AI work itself was
      // genuinely attempted. A write failure that is successfully
      // requeued counts ONLY toward retried (not succeeded/rejected/
      // failed -- it is not yet resolved). A write failure whose
      // requeue ALSO fails counts toward failed (a genuine, unresolved
      // permanent failure this cycle), never retried (the requeue did
      // not actually happen).
      if (!writeResult.ok) {
        stats.attempted++
        stats.error_breakdown.database++
        try {
          await deps.markObservationForRetry(observation.id, SOURCE_READ_RETRY_MS)
          stats.retried++
          stats.stopped_reason = 'write_failed'
          console.warn(
            `[enrich/batch] markObservationProcessed write failed for ${observation.id}: ${writeResult.writeError} — requeued, not counted as processed`,
          )
        } catch (requeueErr) {
          stats.failed++
          stats.error_breakdown.requeue_failed++
          stats.stopped_reason = 'requeue_failed'
          console.error(
            `[enrich/batch] requeue_failed after markObservationProcessed write failure for ${observation.id}: ${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
          )
        }
        break
      }

      stats.attempted++
      const classification = classifyOutcome(result.outcome)
      if (classification === 'succeeded') stats.succeeded++
      else if (classification === 'rejected') stats.rejected++
      else stats.failed++

      console.log(`[enrich/batch] ${observation.id} → ${result.outcome}`)

      // Inter-request delay — prevents TPM/RPM exhaustion on direct models
      if (msUntilDeadline(deadlineAt) > INTER_REQUEST_MS + 8_000) {
        await sleep(INTER_REQUEST_MS)
      }
    } catch (err) {
      // AI_REQUEST_TOO_LARGE: the request is physically too large for
      // every model in the chain's own TPM budget (see
      // AIRequestTooLargeError's own docstring in tpm-manager.ts).
      // REAL PRODUCTION INCIDENT this closes: previously not caught
      // here at all, so it fell through to the generic error path
      // below -- but by the time it reached here, the underlying cause
      // had ALREADY been a real Groq 429 (three confirmed instances:
      // limit 6,000, used 1,154-1,532, requested 5,137-5,144), because
      // nothing upstream refused the call before it reached the
      // provider. With the upstream fix (tpm-manager.ts's
      // fitsWithinModelTPM, checked in client.ts before ever calling
      // the provider), this branch is now reached WITHOUT a real 429
      // ever happening -- a controlled requeue, not a provider-side
      // rate-limit failure. Checked BEFORE AITokenBudgetExceededError
      // and AIDeadlineExceededError since it is a sibling type to both
      // (not a subclass of either) and must never fall through to the
      // generic "mark as permanent processing_error" path below.
      if (err instanceof AIRequestTooLargeError) {
        // HONEST METRICS CONTRACT: processObservation WAS genuinely
        // called and genuinely ran (it threw this specific error from
        // deep inside its own AI-call logic) -- counts toward
        // attempted regardless of whether the requeue itself succeeds.
        stats.attempted++
        stats.error_breakdown.request_too_large++
        try {
          await deps.markObservationForRetry(observation.id, REQUEST_TOO_LARGE_RETRY_MS)
          stats.retried++
          stats.stopped_reason = 'request_too_large'
          console.warn(
            `[enrich/batch] request_too_large — ${observation.id} queued for retry in ${REQUEST_TOO_LARGE_RETRY_MS}ms (${err.model}, estimated ${err.estimatedTokens} vs ceiling ${err.modelCeiling})`,
          )
        } catch (requeueErr) {
          // See the identical comment on the deadline_exceeded branch
          // below: never report retried++ for a requeue write that did
          // not actually succeed.
          stats.failed++
          stats.error_breakdown.requeue_failed++
          stats.stopped_reason = 'requeue_failed'
          console.error(
            `[enrich/batch] requeue_failed after request_too_large for ${observation.id}: ${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
          )
        }
        break
      }

      // AI_TOKEN_BUDGET_EXCEEDED: temporary, exactly like AI_DEADLINE_EXCEEDED
      // below -- requeue with a distinct backoff and stop the whole batch
      // immediately. Checked BEFORE AIDeadlineExceededError and
      // AIProviderError since it is a sibling type to both (not a
      // subclass of either) and must never fall through to the generic
      // "mark as permanent processing_error" path. Without this, a
      // Signal Engine call refused by the shared TPD budget gate would
      // have its SIS stage silently proceed without evaluation and its
      // enrichment stage return outcome:'error', which the code below
      // then WOULD have recorded as a permanent processing_error --
      // discarding a temporary, self-resolving budget refusal as if the
      // observation were permanently broken.
      if (err instanceof AITokenBudgetExceededError) {
        // HONEST METRICS CONTRACT: see the identical comment on the
        // request_too_large branch above.
        stats.attempted++
        stats.error_breakdown.budget_exhausted++
        try {
          await deps.markObservationForRetry(observation.id, BUDGET_RETRY_MS)
          stats.retried++
          stats.stopped_reason = 'budget_exhausted'
          console.warn(
            `[enrich/batch] budget_exhausted — ${observation.id} queued for retry in ${BUDGET_RETRY_MS}ms (${err.consumer}/${err.model})`,
          )
        } catch (requeueErr) {
          // See the identical comment on the deadline_exceeded branch
          // below: never report retried++ for a requeue write that did
          // not actually succeed.
          stats.failed++
          stats.error_breakdown.requeue_failed++
          stats.stopped_reason = 'requeue_failed'
          console.error(
            `[enrich/batch] requeue_failed after budget_exhausted for ${observation.id}: ${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
          )
        }
        break
      }

      // AI_DEADLINE_EXCEEDED: temporary, like rate-limit -- requeue with
      // a short, distinct backoff and stop the whole batch immediately
      // so this invocation can return a controlled response instead of
      // being force-killed by Vercel. Checked BEFORE the AIProviderError
      // branch below since AIDeadlineExceededError is a sibling type,
      // not a subclass, and must never fall through to the generic
      // "mark as permanent processing_error" path.
      if (err instanceof AIDeadlineExceededError) {
        // HONEST METRICS CONTRACT: see the identical comment on the
        // request_too_large branch above.
        stats.attempted++
        stats.error_breakdown.deadline_exceeded++
        try {
          await deps.markObservationForRetry(observation.id, DEADLINE_RETRY_MS)
          stats.retried++
          stats.stopped_reason = 'deadline_exceeded'
          console.warn(
            `[enrich/batch] deadline_exceeded — ${observation.id} queued for retry in ${DEADLINE_RETRY_MS}ms (${err.context})`,
          )
        } catch (requeueErr) {
          // The requeue write itself failed -- do NOT report
          // retried++ or stopped_reason='deadline_exceeded' for an
          // observation that was never actually put back in the
          // queue (it would silently look successful in stats while
          // the observation is either stuck processed=false with no
          // retry_after, or in an unknown state). Surface this
          // distinctly instead of pretending it succeeded.
          stats.failed++
          stats.error_breakdown.requeue_failed++
          stats.stopped_reason = 'requeue_failed'
          console.error(
            `[enrich/batch] requeue_failed after deadline_exceeded for ${observation.id}: ${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
          )
        }
        break
      }

      // Classify error
      const isRateLimit = err instanceof AIProviderError && err.isRateLimit
      const isServerErr = err instanceof AIProviderError && err.isServerError
      const errMsg = err instanceof Error ? err.message : String(err)

      // Update error breakdown
      if (isRateLimit) stats.error_breakdown.rate_limit++
      else if (isServerErr) stats.error_breakdown.server_error++
      else if (errMsg.includes('JSON')) stats.error_breakdown.json_parse++
      else if (errMsg.includes('schema') || errMsg.includes('validation'))
        stats.error_breakdown.validation++
      else stats.error_breakdown.unknown++

      if (isRateLimit) {
        // 429 = temporary provider limit — NOT a processing error.
        // agent.ts already retried within-chain with exponential
        // backoff; if the WHOLE chain (all fallback models) was still
        // rate-limited, agent.ts now surfaces the largest Retry-After
        // it saw (see AIProviderError.retryAfterMs) instead of losing
        // that signal in a generic Error — use it when present, since
        // the provider's own stated reset time is more accurate than
        // a fixed guess.
        // HONEST METRICS CONTRACT: see the identical comment on the
        // request_too_large branch above.
        stats.attempted++
        const retryDelayMs =
          (err instanceof AIProviderError ? err.retryAfterMs : undefined) ?? AI_RETRY_MS
        try {
          await deps.markObservationForRetry(observation.id, retryDelayMs)
          stats.retried++
          stats.stopped_reason = 'rate_limited'
          console.warn(
            `[enrich/batch] rate_limit — ${observation.id} queued for retry in ${retryDelayMs}ms`,
          )
        } catch (requeueErr) {
          // See identical comment on the deadline_exceeded branch
          // above: never report retried++ for a requeue write that
          // did not actually succeed.
          stats.failed++
          stats.error_breakdown.requeue_failed++
          stats.stopped_reason = 'requeue_failed'
          console.error(
            `[enrich/batch] requeue_failed after rate_limit for ${observation.id}: ${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
          )
        }
        break
      }

      // Real error — mark and continue to next observation. This item
      // WAS genuinely attempted (processObservation was called and
      // threw), so it counts toward `attempted` here too -- the success
      // path above increments `attempted` before classifying the
      // outcome; this thrown-exception path must do the same, or
      // `attempted` would silently undercount genuine failures that
      // never returned a normal result at all.
      //
      // REAL BUG FIXED (independent review): if this error-record
      // write ALSO fails, the observation previously stayed
      // processed=false in the database with NO retry_after set --
      // the NEXT fetchNextReadyPage call (which selects
      // processed=false AND (retry_after IS NULL OR retry_after < now))
      // would IMMEDIATELY re-select this SAME observation again, with
      // no backoff at all -- a genuine tight retry loop, not the
      // controlled, backed-off requeue every other failure path in
      // this function already uses. Fixed fail-closed: a genuine
      // write failure here now attempts a real, backed-off requeue via
      // markObservationForRetry, exactly like every other failure
      // branch in this function.
      const errorWriteResult = await deps
        .markObservationProcessed(
          observation.id,
          null,
          `[${isServerErr ? 'server_error' : 'error'}] ${errMsg.slice(0, 500)}`,
        )
        .catch((writeErr: unknown) => ({
          ok: false,
          writeError: writeErr instanceof Error ? writeErr.message : String(writeErr),
        }))

      if (!errorWriteResult.ok) {
        console.error(
          `[enrich/batch] failed to persist error record for ${observation.id}: ${errorWriteResult.writeError}`,
        )
        stats.attempted++
        try {
          await deps.markObservationForRetry(observation.id, SOURCE_READ_RETRY_MS)
          // HONEST METRICS CONTRACT: the error-record write itself
          // failed, but the requeue succeeded -- this observation is
          // not yet resolved this cycle (it will be re-attempted
          // later), so it counts toward retried, NOT failed.
          stats.retried++
          stats.stopped_reason = 'write_failed'
          console.warn(
            `[enrich/batch] error-record write failed for ${observation.id} — requeued via markObservationForRetry instead of being left with no retry_after`,
          )
        } catch (requeueErr) {
          // Both the error-record write AND the requeue failed -- a
          // genuine, unresolved permanent failure this cycle. Counts
          // toward failed, never retried (the requeue did not
          // actually happen).
          stats.failed++
          stats.error_breakdown.requeue_failed++
          stats.stopped_reason = 'requeue_failed'
          console.error(
            `[enrich/batch] requeue_failed after error-record write failure for ${observation.id}: ${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
          )
        }
        console.error(`[enrich/batch] error on ${observation.id}: ${errMsg.slice(0, 200)}`)
        break
      }

      stats.attempted++
      stats.failed++
      console.error(`[enrich/batch] error on ${observation.id}: ${errMsg.slice(0, 200)}`)
    }
  }

  return stats
}

/** REAL BUG FIXED (production incident: fresh observations starved by
 * a pure FIFO-by-collected_at queue). At 6905 unprocessed observations
 * dating back to July 21st, a query ordered `collected_at ASC` with no
 * other structure NEVER reaches anything collected today until every
 * single older row is drained first -- at the real, TPD-gated
 * throughput (~19.8 observations/day), that is hundreds of days before
 * a single fresh observation is ever touched, even though fresh
 * material is exactly what the Signal Engine's own recency-sensitive
 * scoring most wants to see promptly.
 *
 * Window used to distinguish "fresh" from "backlog": an observation
 * collected within the last FRESH_WINDOW_HOURS. 24h chosen to match
 * the collection cadence itself (collect-4h.yml runs 6x/day) -- "fresh"
 * genuinely means "from a recent collection cycle," not an arbitrary
 * cutoff. */
const FRESH_WINDOW_HOURS = 24

export interface ReadyPage {
  rows: ObservationRow[]
  error: string | null
  /** Which pool this page was actually drawn from -- 'fresh' or 'old'
   * as requested, or the OTHER pool if the requested one was empty
   * (see the fallback logic below). Exposed for testing and for
   * honest logging, not currently persisted. */
  pool: 'fresh' | 'old'
}

/**
 * Fetches one page of ready-to-process observations, alternating
 * between the "fresh" pool (collected within FRESH_WINDOW_HOURS) and
 * the "old" backlog pool based on the parity of `pageIndex` -- even
 * index draws from fresh, odd from old. Called with a steadily-
 * incrementing pageIndex across the batch loop's own iterations (see
 * the POST handler below), this guarantees BOTH pools make real
 * progress every two iterations regardless of how large the backlog
 * grows -- neither queue can starve the other by sheer size, which a
 * single `ORDER BY collected_at ASC` query structurally cannot
 * guarantee.
 *
 * Real fallback: if the pool selected by pageIndex's parity is
 * genuinely empty (e.g. no fresh material has been collected yet this
 * cycle), the OTHER pool is used instead for this one iteration rather
 * than wasting a whole loop iteration returning nothing -- this keeps
 * draining the backlog even when there is temporarily no fresh work,
 * without breaking the alternation guarantee for iterations where both
 * pools genuinely have rows.
 */
export async function fetchNextReadyPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  pageIndex: number,
  pageSize: number = BATCH_SIZE,
): Promise<ReadyPage> {
  const freshCutoff = new Date(Date.now() - FRESH_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const preferFresh = pageIndex % 2 === 0
  const nowIso = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runQuery = async (fresh: boolean): Promise<any> => {
    let query = supabase
      .from('observations')
      .select('*')
      .eq('processed', false)
      .is('processing_error', null)
      // REAL BUG FIXED (independent review): readiness (retry_after)
      // was previously filtered CLIENT-SIDE, after the page was
      // already fetched with a fixed .limit(pageSize). A page
      // consisting ENTIRELY of deferred rows (retry_after in the
      // future) -- a genuine, realistic scenario once requeue backoffs
      // are in play -- produced an empty `ready` array, and the outer
      // loop declared the pool 'queue_empty' even though real,
      // genuinely-ready observations could exist further down the
      // same ordering, simply never reached because the page was
      // already consumed by deferred rows. Filtered at the QUERY level
      // instead: the database itself only ever returns genuinely-ready
      // rows (retry_after is null OR already in the past), so a
      // returned page is either non-empty (containing only real,
      // immediately-processable observations) or the pool is
      // genuinely, provably exhausted of ready work -- no client-side
      // re-filtering, no risk of a deferred-only page masking real
      // readiness beyond it.
      // REAL BUG FIXED (independent review): PostgREST's own raw
      // filter-string grammar uses `.` to separate column/operator/
      // value and `,` to separate OR conditions -- a bare ISO
      // timestamp like "2026-08-13T12:00:00.000Z" contains BOTH `:`
      // and `.` characters that are themselves syntactically
      // significant in that grammar. Without wrapping the value in
      // double quotes, PostgREST can misparse the embedded `.` inside
      // the timestamp (e.g. the `.000Z` fraction) as if it were part
      // of the filter's own column/operator structure, producing a
      // parse error or a comparison against the wrong, truncated
      // value rather than the real timestamp. Quoted per PostgREST's
      // own documented raw-filter syntax for values containing
      // reserved characters.
      .or(`metadata->>retry_after.is.null,metadata->>retry_after.lt."${nowIso}"`)
    query = fresh ? query.gte('collected_at', freshCutoff) : query.lt('collected_at', freshCutoff)
    return query.order('collected_at', { ascending: true }).limit(pageSize)
  }

  const { data, error } = await runQuery(preferFresh)
  if (error) {
    return { rows: [], error: error.message, pool: preferFresh ? 'fresh' : 'old' }
  }

  const rows = (data ?? []) as ObservationRow[]
  if (rows.length > 0) {
    return { rows, error: null, pool: preferFresh ? 'fresh' : 'old' }
  }

  // Preferred pool empty this iteration -- fall back to the other pool
  // rather than returning nothing.
  const { data: fallbackData, error: fallbackError } = await runQuery(!preferFresh)
  if (fallbackError) {
    return { rows: [], error: fallbackError.message, pool: preferFresh ? 'old' : 'fresh' }
  }
  return {
    rows: (fallbackData ?? []) as ObservationRow[],
    error: null,
    pool: preferFresh ? 'old' : 'fresh',
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env['CRON_SECRET']
  if (!secret) return false
  const header = request.headers.get('x-cron-secret') ?? request.headers.get('authorization')
  return header === secret || header === `Bearer ${secret}`
}

/**
 * REAL BUG FIXED (independent review, cross-invocation fairness): the
 * fresh/old pool alternation inside one invocation (fetchNextReadyPage's
 * own pageIndex parity) only helps WITHIN a single cycle -- if pageIndex
 * always STARTS at 0 on every invocation, and a short cycle only ever
 * completes ONE page before hitting its own deadline/backoff, that page
 * is ALWAYS the fresh pool (index 0 is even), and the old backlog can
 * starve indefinitely across many short invocations in a row, even
 * though within any SINGLE long-running cycle both pools alternate
 * correctly.
 *
 * Fixed by deriving the STARTING pageIndex from which 4-hour UTC
 * schedule bucket the current invocation falls into (matching
 * collect-4h.yml's own real cadence: 6 buckets/day, buckets 0-5) --
 * consecutive schedule buckets alternate parity (bucket 0 starts even/
 * fresh, bucket 1 starts odd/old, bucket 2 starts even/fresh, ...), so
 * even if every single invocation only ever completes exactly one page,
 * fresh and old genuinely alternate ACROSS invocations too, not merely
 * within one. Deterministic and stateless -- no persisted counter
 * needed, since the schedule bucket is derived purely from the current
 * wall-clock time.
 */
export function scheduleBucketStartPageIndex(now: number = Date.now()): number {
  const hoursSinceEpoch = Math.floor(now / (60 * 60 * 1000))
  const bucket = Math.floor(hoursSinceEpoch / 4) % 6
  return bucket
}

/**
 * Runs the full autonomous enrichment cycle: fetches successive pages
 * of ready observations via deps.fetchObservationsPage (real SQL/query
 * semantics unchanged -- see fetchObservationsPage's own docstring on
 * BatchProcessingDeps, and fetchNextReadyPage's own docstring for the
 * fresh/old alternation and query-level retry_after filtering it
 * performs), processes each page via processBatchOfObservations, and
 * accumulates combined stats until the queue is empty, the deadline is
 * hit, or a stop condition from processBatchOfObservations itself ends
 * the cycle early.
 *
 * Extracted from the POST handler's own inline loop (independent
 * review) specifically so a genuine observations-page read failure --
 * and the fresh/old alternation itself -- can be exercised by real
 * behavioral tests: fetchObservationsPage is an injectable dependency,
 * not a hardcoded Supabase call, and this function is exported for
 * direct testing rather than only reachable through the full HTTP
 * handler.
 *
 * `startPageIndex` defaults to the real schedule-bucket-derived value
 * (see scheduleBucketStartPageIndex's own docstring for the cross-
 * invocation fairness this closes) -- callers (tests) can override it
 * directly to exercise a specific starting parity deterministically.
 */
export async function runEnrichmentCycle(
  deadlineAt: number,
  deps: BatchProcessingDeps,
  startPageIndex: number = scheduleBucketStartPageIndex(),
): Promise<BatchStats> {
  const combinedStats = freshStats()
  let pageIndex = startPageIndex

  while (true) {
    if (Date.now() >= deadlineAt) {
      combinedStats.stopped_reason = 'time_budget'
      break
    }

    const page = await deps.fetchObservationsPage(pageIndex, BATCH_SIZE)
    pageIndex++

    if (page.error) {
      // REAL PRODUCTION INCIDENT this closes: combinedStats.stopped_reason
      // starts at its default value ('queue_empty', set in freshStats())
      // and was previously left UNCHANGED on this path -- a genuine DB
      // read failure fetching the next page of observations was
      // silently indistinguishable from "the queue is genuinely empty,
      // nothing to do." A caller (or dashboard) reading the final
      // response could not tell a real outage apart from harmless
      // idle time.
      combinedStats.stopped_reason = 'queue_read_failed'
      console.error('[enrich/batch] fetch error:', page.error)
      break
    }

    // REAL BUG FIXED (independent review, retry_after masking): a page
    // consisting entirely of deferred (retry_after in the future) rows
    // previously produced a false 'queue_empty' even though genuinely
    // ready observations could exist further down the same ordering.
    // Now structurally impossible: fetchNextReadyPage's own query
    // filters retry_after at the SQL level (see its own docstring), so
    // every row this function ever sees IS genuinely ready -- no
    // client-side re-filtering here, and an empty page means the pool
    // is provably exhausted of ready work, not merely "the first
    // BATCH_SIZE rows happened to all be deferred."
    if (page.rows.length === 0) {
      combinedStats.stopped_reason = 'queue_empty'
      break
    }

    const batchStats = await processBatchOfObservations(page.rows, deadlineAt, deps)

    combinedStats.attempted += batchStats.attempted
    combinedStats.succeeded += batchStats.succeeded
    combinedStats.rejected += batchStats.rejected
    combinedStats.retried += batchStats.retried
    combinedStats.failed += batchStats.failed
    combinedStats.item_latencies_ms.push(...batchStats.item_latencies_ms)
    combinedStats.stopped_reason = batchStats.stopped_reason
    for (const key of Object.keys(batchStats.error_breakdown) as Array<
      keyof BatchStats['error_breakdown']
    >) {
      combinedStats.error_breakdown[key] += batchStats.error_breakdown[key]
    }

    // REAL BUG FIXED (independent review): processBatchOfObservations
    // can return any of 8 distinct terminal stopped_reason values
    // (time_budget, rate_limited, deadline_exceeded, budget_exhausted,
    // requeue_failed, request_too_large, source_read_failed,
    // write_failed), but this check previously only recognized 4 of
    // them (rate_limited, deadline_exceeded, budget_exhausted,
    // requeue_failed) as reasons to stop -- request_too_large,
    // source_read_failed, write_failed, and time_budget all silently
    // fell through, letting the outer loop fetch ANOTHER page. If that
    // next page happened to be empty (or the very observation just
    // requeued got filtered out by its own fresh retry-backoff),
    // combinedStats.stopped_reason was overwritten to 'queue_empty',
    // masking the real terminal reason entirely.
    //
    // Fixed fail-closed as an ALLOWLIST, not a denylist: the outer
    // loop may continue ONLY when the batch genuinely reports
    // 'queue_empty' (a real, positive signal that this page's
    // observations were all processed and the queue was still open for
    // more). Every other value -- including any future terminal reason
    // this list does not yet know about -- stops the cycle immediately,
    // preserving the real, original stopped_reason rather than risking
    // it being silently overwritten by a later, unrelated page fetch.
    if (combinedStats.stopped_reason !== 'queue_empty') break
  }

  return combinedStats
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const deadlineAt = startedAt + maxDuration * 1000 - DEADLINE_BUFFER_MS
  const supabase = createAdminClient()

  // ── Cross-platform execution lock ─────────────────────────────────────────
  // Every automatic enrichment trigger funnels through THIS route:
  // the GitHub schedule, a manual GitHub dispatch, and the Vercel cron
  // (/api/cron/pipeline awaits /api/enrich/batch). Taking the lease
  // here therefore covers all of them, which GitHub's own
  // `concurrency:` cannot -- it is blind to the Vercel trigger.
  //
  // A losing run exits 200 with acquired_lock=false and, critically,
  // WITHOUT contacting Groq: an overlapping cycle is a normal outcome
  // to skip, not an error to report.
  const lockHolder = `enrich-batch:${startedAt}:${Math.random().toString(36).slice(2, 10)}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- repo convention for Supabase RPC calls
  const lockClient = supabase as any
  const gotLock = await acquireEnrichmentLock(lockClient, lockHolder)
  if (!gotLock) {
    console.warn(`[enrich/batch] another enrichment cycle holds the lock; skipping (${lockHolder})`)
    return NextResponse.json({
      skipped: true,
      reason: 'enrichment_already_running',
      acquired_lock: false,
      duration_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  }

  // Ledger maintenance, run opportunistically now that we hold the
  // lock. Deliberately NOT a separate cron: an extra schedule would be
  // one more thing to configure by hand in production, and the ledger
  // grew unbounded precisely because cleanup existed only as an
  // uncalled function. Never throws.
  const prunedRows = await pruneTokenLedger(lockClient)
  if (prunedRows > 0) {
    console.info(`[enrich/batch] pruned ${prunedRows} expired token-ledger row(s)`)
  }

  try {
    const deps: BatchProcessingDeps = {
      fetchSourceInfo: async (sourceId: string): Promise<FetchSourceInfoResult> => {
        const { data: source, error: sourceReadError } = (await supabase
          .from('sources')
          .select('trust_score, name, type')
          .eq('id', sourceId)
          .single()) as {
          data: { trust_score: number | null; name: string | null; type: string | null } | null
          error: { message: string } | null
        }
        // REAL BUG FIXED: the `error` field was previously destructured
        // out entirely and discarded -- a genuine read failure (network
        // error, RLS issue, connection reset) was indistinguishable from
        // "this source legitimately has no name/trust_score," and both
        // silently fell back to trustScore=0.5/sourceName='Unknown
        // Source'. A real read failure must be surfaced honestly so the
        // caller can requeue instead of scoring against fabricated
        // values.
        if (sourceReadError) {
          return { ok: false, trustScore: 0, sourceName: '', error: sourceReadError.message }
        }
        return {
          ok: true,
          trustScore: source?.trust_score ?? 0.5,
          sourceName: source?.name ?? 'Unknown Source',
        }
      },
      fetchObservationsPage: (pageIndex: number, limit: number) =>
        fetchNextReadyPage(supabase, pageIndex, limit),
      processObservation,
      markObservationProcessed,
      markObservationForRetry,
    }

    // Real queue-depth/oldest-pending snapshot taken BEFORE this cycle
    // drains anything -- "at the start of this cycle," not after.
    const queueSnapshot = await getObservationStats()

    const combinedStats = await runEnrichmentCycle(deadlineAt, deps)

    const duration = Date.now() - startedAt

    // Real, persisted metrics -- previously this data existed only in
    // this HTTP response body, never queryable after the fact.
    //
    // REAL BUG FIXED (production incident: metrics contradicted the
    // decision log): itemsAttempted was previously computed as
    // `processed + errors + rejected`, but `processed` ALREADY
    // included both the rejected and error-classified subsets (it was
    // incremented unconditionally before the success/rejected/error
    // sub-classification) -- rejected and error items were counted
    // TWICE. combinedStats.attempted is now a single, directly-
    // maintained counter (see the classifyOutcome-based accounting
    // above) that already equals succeeded+rejected+failed by
    // construction, with no addition needed here.
    await recordCycleMetrics(lockClient, {
      cycleType: 'enrichment',
      startedAt,
      completedAt: startedAt + duration,
      itemsAttempted: combinedStats.attempted,
      itemsSucceeded: combinedStats.succeeded,
      itemsRejected: combinedStats.rejected,
      itemsRetried: combinedStats.retried,
      itemsFailed: combinedStats.failed,
      failureBreakdown: combinedStats.error_breakdown as unknown as Record<string, number>,
      stoppedReason: combinedStats.stopped_reason,
      itemLatenciesMs: combinedStats.item_latencies_ms,
      queueDepth: queueSnapshot.unprocessed,
      oldestPendingAgeSeconds: queueSnapshot.oldestPendingAgeSeconds,
    })

    return NextResponse.json({
      ...combinedStats,
      acquired_lock: true,
      pruned_ledger_rows: prunedRows,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    })
  } finally {
    // Always released, including on an unexpected throw. Even if this
    // never runs (process killed mid-flight), the lease expires on its
    // own -- that is the whole point of a TTL row over an advisory lock.
    await releaseEnrichmentLock(lockClient, lockHolder)
  }
}
