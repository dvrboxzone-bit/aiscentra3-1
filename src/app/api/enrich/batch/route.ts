/**
 * AIscentra — Autonomous Batch Enrichment
 *
 * POST /api/enrich/batch
 *
 * Batch sizing rationale:
 *   - Vercel Hobby maxDuration = 60s
 *   - Average AI call (Groq): 3–6s → pessimistic estimate: 6s
 *   - DB overhead per observation: ~1s
 *   - Safe batch size: floor(60s / 7s) = 8 observations
 *   - Safety margin 10% → BATCH_SIZE = 7
 * (BATCH_SIZE itself is explicitly out of scope for this change --
 * unchanged at 3.)
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
import { processObservation } from '@/modules/signals/engine'
import {
  markObservationProcessed,
  markObservationForRetry,
  getObservationStats,
} from '@/modules/observations/queries'
import { AIProviderError } from '@/lib/ai/client'
import { AIDeadlineExceededError, msUntilDeadline } from '@/lib/ai/deadline'
import { AITokenBudgetExceededError } from '@/lib/ai/budget-gate'
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
const BATCH_SIZE = 3 // 3 observations per run — conservative for stability. UNCHANGED.
const DEADLINE_BUFFER_MS = 10_000 // >=10s between deadline and Vercel's actual kill, for requeue + response
const AI_RETRY_MS = 30_000 // 30s backoff after 429 (no Retry-After header available)
const DEADLINE_RETRY_MS = 10_000 // short backoff after AI_DEADLINE_EXCEEDED -- distinct from rate-limit backoff
const BUDGET_RETRY_MS = 60_000 // backoff after AI_TOKEN_BUDGET_EXCEEDED -- longer than a deadline miss,
// since a daily/rolling-window budget refusal will not resolve in seconds. The real backstop
// is the next scheduled enrichment cycle (~4h away, see enrich-batch-hourly.yml), which will
// re-fetch this observation regardless of the exact value once its retry_after has passed.
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
  processed: number
  signal_created: number
  rejected: number
  retried: number
  errors: number
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
    unknown: number
  }
}

function freshStats(): BatchStats {
  return {
    processed: 0,
    signal_created: 0,
    rejected: 0,
    retried: 0,
    errors: 0,
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
export interface BatchProcessingDeps {
  fetchSourceInfo: (sourceId: string) => Promise<{ trustScore: number; sourceName: string }>
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
      const { trustScore, sourceName } = await deps.fetchSourceInfo(observation.source_id)

      const itemStartedAt = Date.now()
      const result = await deps.processObservation(
        observation,
        trustScore,
        sourceName,
        '',
        deadlineAt,
      )
      stats.item_latencies_ms.push(Date.now() - itemStartedAt)

      await deps.markObservationProcessed(
        observation.id,
        result.signalId ?? null,
        result.outcome === 'error' ? result.reason : undefined,
      )

      stats.processed++
      if (result.outcome === 'signal_created') stats.signal_created++
      else if (result.outcome.startsWith('rejected')) stats.rejected++
      else stats.errors++

      console.log(`[enrich/batch] ${observation.id} → ${result.outcome}`)

      // Inter-request delay — prevents TPM/RPM exhaustion on direct models
      if (msUntilDeadline(deadlineAt) > INTER_REQUEST_MS + 8_000) {
        await sleep(INTER_REQUEST_MS)
      }
    } catch (err) {
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
          stats.error_breakdown.requeue_failed++
          stats.stopped_reason = 'requeue_failed'
          console.error(
            `[enrich/batch] requeue_failed after rate_limit for ${observation.id}: ${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
          )
        }
        break
      }

      // Real error — mark and continue to next observation
      await deps
        .markObservationProcessed(
          observation.id,
          null,
          `[${isServerErr ? 'server_error' : 'error'}] ${errMsg.slice(0, 500)}`,
        )
        .catch(() => {})
      stats.errors++
      console.error(`[enrich/batch] error on ${observation.id}: ${errMsg.slice(0, 200)}`)
    }
  }

  return stats
}

function isAuthorized(request: Request): boolean {
  const secret = process.env['CRON_SECRET']
  if (!secret) return false
  const header = request.headers.get('x-cron-secret') ?? request.headers.get('authorization')
  return header === secret || header === `Bearer ${secret}`
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
      fetchSourceInfo: async (sourceId: string) => {
        const { data: source } = (await supabase
          .from('sources')
          .select('trust_score, name, type')
          .eq('id', sourceId)
          .single()) as {
          data: { trust_score: number | null; name: string | null; type: string | null } | null
        }
        return {
          trustScore: source?.trust_score ?? 0.5,
          sourceName: source?.name ?? 'Unknown Source',
        }
      },
      processObservation,
      markObservationProcessed,
      markObservationForRetry,
    }

    const combinedStats = freshStats()

    // Real queue-depth/oldest-pending snapshot taken BEFORE this cycle
    // drains anything -- "at the start of this cycle," not after.
    const queueSnapshot = await getObservationStats()

    // ── Autonomous loop — runs until queue empty or the shared deadline ─────────
    while (true) {
      if (Date.now() >= deadlineAt) {
        combinedStats.stopped_reason = 'time_budget'
        break
      }

      // Fetch next batch of ready observations
      const { data: rows, error: fetchErr } = await supabase
        .from('observations')
        .select('*')
        .eq('processed', false)
        .is('processing_error', null)
        .order('collected_at', { ascending: true })
        .limit(BATCH_SIZE)

      if (fetchErr) {
        console.error('[enrich/batch] fetch error:', fetchErr.message)
        break
      }

      const observations = (rows ?? []) as ObservationRow[]
      const now = new Date().toISOString()

      // Filter retry-backoff observations
      const ready = observations.filter((obs) => {
        const retryAfter = (obs.metadata as { retry_after?: string })?.retry_after
        return !retryAfter || retryAfter < now
      })

      if (ready.length === 0) {
        combinedStats.stopped_reason = 'queue_empty'
        break
      }

      const batchStats = await processBatchOfObservations(ready, deadlineAt, deps)

      combinedStats.processed += batchStats.processed
      combinedStats.signal_created += batchStats.signal_created
      combinedStats.rejected += batchStats.rejected
      combinedStats.retried += batchStats.retried
      combinedStats.errors += batchStats.errors
      combinedStats.item_latencies_ms.push(...batchStats.item_latencies_ms)
      combinedStats.stopped_reason = batchStats.stopped_reason
      for (const key of Object.keys(batchStats.error_breakdown) as Array<
        keyof BatchStats['error_breakdown']
      >) {
        combinedStats.error_breakdown[key] += batchStats.error_breakdown[key]
      }

      // If we hit rate limit, the deadline, or a requeue write failure,
      // stop the loop entirely -- next run (rate limit) or the requeue's
      // own backoff (deadline) will pick this back up. A requeue failure
      // is stopped for safety even though we don't know the observation's
      // exact resulting state -- continuing to process further
      // observations while one is in an uncertain state is not worth the
      // risk.
      if (
        combinedStats.stopped_reason === 'rate_limited' ||
        combinedStats.stopped_reason === 'deadline_exceeded' ||
        combinedStats.stopped_reason === 'budget_exhausted' ||
        combinedStats.stopped_reason === 'requeue_failed'
      )
        break
    }

    const duration = Date.now() - startedAt

    // Real, persisted metrics -- previously this data existed only in
    // this HTTP response body, never queryable after the fact.
    await recordCycleMetrics(lockClient, {
      cycleType: 'enrichment',
      startedAt,
      completedAt: startedAt + duration,
      itemsAttempted: combinedStats.processed + combinedStats.errors + combinedStats.rejected,
      itemsSucceeded: combinedStats.signal_created,
      itemsFailed: combinedStats.errors,
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
