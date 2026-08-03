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
 *   agent.ts's retry/backoff logic (5s/10s/20s/40s schedule, no time-
 *   budget awareness) could legitimately spend 75+ seconds on a single
 *   observation, confirmed live via Vercel's runtime error log ("Task
 *   timed out after 60 seconds" on this exact route, recurring since
 *   2026-07-28). DEADLINE_BUFFER_MS below leaves at least 10s between
 *   the deadline and Vercel's actual kill point, specifically so a
 *   deadline-triggered requeue and this function's own JSON response
 *   have time to complete.
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
import { markObservationProcessed, markObservationForRetry } from '@/modules/observations/queries'
import { AIProviderError } from '@/lib/ai/client'
import { AIDeadlineExceededError, msUntilDeadline } from '@/lib/ai/deadline'
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
const INTER_REQUEST_MS = 6_000 // 6s between requests — 10 RPM effective rate

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

  const stats = {
    processed: 0,
    signal_created: 0,
    rejected: 0,
    retried: 0,
    errors: 0,
    stopped_reason: 'queue_empty' as
      | 'queue_empty'
      | 'time_budget'
      | 'rate_limited'
      | 'deadline_exceeded',
    // Detailed error breakdown per analysis report
    error_breakdown: {
      rate_limit: 0,
      server_error: 0,
      timeout: 0,
      deadline_exceeded: 0,
      json_parse: 0,
      validation: 0,
      database: 0,
      unknown: 0,
    },
  }

  // ── Autonomous loop — runs until queue empty or the shared deadline ─────────
  while (true) {
    if (Date.now() >= deadlineAt) {
      stats.stopped_reason = 'time_budget'
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
      stats.stopped_reason = 'queue_empty'
      break
    }

    // ── Process each observation ─────────────────────────────────────────────
    for (const observation of ready) {
      if (msUntilDeadline(deadlineAt) < 8_000) {
        // Less than 8s left — not enough for another AI call
        stats.stopped_reason = 'time_budget'
        break
      }

      try {
        const { data: source } = (await supabase
          .from('sources')
          .select('trust_score, name, type')
          .eq('id', observation.source_id)
          .single()) as {
          data: { trust_score: number | null; name: string | null; type: string | null } | null
        }

        const trustScore = source?.trust_score ?? 0.5
        const sourceName = source?.name ?? 'Unknown Source'

        const result = await processObservation(observation, trustScore, sourceName, '', deadlineAt)

        await markObservationProcessed(
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
          await new Promise((r) => setTimeout(r, INTER_REQUEST_MS))
        }
      } catch (err) {
        // AI_DEADLINE_EXCEEDED: temporary, like rate-limit -- requeue with
        // a short, distinct backoff and stop the whole batch immediately
        // so this invocation can return a controlled response instead of
        // being force-killed by Vercel. Checked BEFORE the AIProviderError
        // branch below since AIDeadlineExceededError is a sibling type,
        // not a subclass, and must never fall through to the generic
        // "mark as permanent processing_error" path.
        if (err instanceof AIDeadlineExceededError) {
          stats.error_breakdown.deadline_exceeded++
          await markObservationForRetry(observation.id, DEADLINE_RETRY_MS)
          stats.retried++
          stats.stopped_reason = 'deadline_exceeded'
          console.warn(
            `[enrich/batch] deadline_exceeded — ${observation.id} queued for retry in ${DEADLINE_RETRY_MS}ms (${err.context})`,
          )
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
          await markObservationForRetry(observation.id, retryDelayMs)
          stats.retried++
          stats.stopped_reason = 'rate_limited'
          console.warn(
            `[enrich/batch] rate_limit — ${observation.id} queued for retry in ${retryDelayMs}ms`,
          )
          break
        }

        // Real error — mark and continue to next observation
        await markObservationProcessed(
          observation.id,
          null,
          `[${isServerErr ? 'server_error' : 'error'}] ${errMsg.slice(0, 500)}`,
        ).catch(() => {})
        stats.errors++
        console.error(`[enrich/batch] error on ${observation.id}: ${errMsg.slice(0, 200)}`)
      }
    }

    // If we hit rate limit or the deadline, stop the loop entirely --
    // next run (rate limit) or the requeue's own backoff (deadline)
    // will pick this back up.
    if (stats.stopped_reason === 'rate_limited' || stats.stopped_reason === 'deadline_exceeded')
      break
  }

  const duration = Date.now() - startedAt

  return NextResponse.json({
    ...stats,
    duration_ms: duration,
    timestamp: new Date().toISOString(),
  })
}
