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
 *
 * Autonomy:
 *   Processes observations in a loop until queue is empty OR time budget is
 *   exhausted. No manual re-triggers needed mid-queue.
 *
 * HTTP 429 handling:
 *   429 = rate_limit from AI provider — temporary, NOT an error.
 *   Observation is returned to queue via markObservationForRetry() with 60s backoff.
 *   It will be picked up in the next batch run automatically.
 *
 * Called by: /api/cron/pipeline (daily Vercel Cron)
 * Also available for manual drain.
 */
import { NextResponse }                   from 'next/server'
import { createAdminClient }              from '@/lib/supabase/server'
import { processObservation }             from '@/modules/signals/engine'
import {
  markObservationProcessed,
  markObservationForRetry,
}                                         from '@/modules/observations/queries'
import { AIProviderError }                from '@/lib/ai/client'
import type { ObservationRow }            from '@/modules/observations/queries'

export const maxDuration = 60
export const dynamic     = 'force-dynamic'

// ── Batch sizing & rate limiting ──────────────────────────────────────────────
// Direct models: llama-3.3-70b (12K TPM) + llama-3.1-8b (fallback)
// Each enrichment: ~1000-1500 tokens → max 8-12 requests/minute safely
// Conservative: 1 request per 6s = 10 requests/minute (20% headroom)
// TIME_BUDGET 54s → max 9 requests but we cap at 3 for stability
const BATCH_SIZE         = 3       // 3 observations per run — conservative for stability
const TIME_BUDGET        = 54_000  // 54s — leave 6s buffer before Vercel kills function
const AI_RETRY_MS        = 30_000  // 30s backoff after 429
const INTER_REQUEST_MS   = 6_000   // 6s between requests — 10 RPM effective rate

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
  const supabase  = createAdminClient()

  const stats = {
    processed:      0,
    signal_created: 0,
    rejected:       0,
    retried:        0,
    errors:         0,
    stopped_reason: 'queue_empty' as 'queue_empty' | 'time_budget' | 'rate_limited',
    // Detailed error breakdown per analysis report
    error_breakdown: {
      rate_limit:  0,
      server_error: 0,
      timeout:     0,
      json_parse:  0,
      validation:  0,
      database:    0,
      unknown:     0,
    },
  }

  // ── Autonomous loop — runs until queue empty or time budget exhausted ───────
  while (true) {
    const elapsed = Date.now() - startedAt
    if (elapsed >= TIME_BUDGET) {
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
      const remaining = TIME_BUDGET - (Date.now() - startedAt)
      if (remaining < 8_000) {
        // Less than 8s left — not enough for another AI call
        stats.stopped_reason = 'time_budget'
        break
      }

      try {
        const { data: source } = await (supabase as any)
          .from('sources')
          .select('trust_score, name')
          .eq('id', observation.source_id)
          .single()

        const trustScore = (source?.trust_score as number | undefined) ?? 0.5
        const sourceName = (source?.name as string | undefined) ?? 'Unknown Source'

        const result = await processObservation(observation, trustScore, sourceName)

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
        const timeLeft = TIME_BUDGET - (Date.now() - startedAt)
        if (timeLeft > INTER_REQUEST_MS + 8_000) {
          await new Promise(r => setTimeout(r, INTER_REQUEST_MS))
        }



      } catch (err) {
        // Classify error
        const isRateLimit  = err instanceof AIProviderError && err.isRateLimit
        const isServerErr  = err instanceof AIProviderError && err.isServerError
        const errMsg       = err instanceof Error ? err.message : String(err)

        // Update error breakdown
        if (isRateLimit)        stats.error_breakdown.rate_limit++
        else if (isServerErr)   stats.error_breakdown.server_error++
        else if (errMsg.includes('JSON'))  stats.error_breakdown.json_parse++
        else if (errMsg.includes('schema') || errMsg.includes('validation')) stats.error_breakdown.validation++
        else                    stats.error_breakdown.unknown++

        if (isRateLimit) {
          // 429 = temporary provider limit — NOT a processing error
          // agent.ts already retried with backoff — if still 429, wait longer
          await markObservationForRetry(observation.id, AI_RETRY_MS)
          stats.retried++
          stats.stopped_reason = 'rate_limited'
          console.warn(`[enrich/batch] rate_limit — ${observation.id} queued for retry in ${AI_RETRY_MS}ms`)
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

    // If we hit rate limit, stop the loop — next cron run will continue
    if (stats.stopped_reason === 'rate_limited') break
  }

  const duration = Date.now() - startedAt

  return NextResponse.json({
    ...stats,
    duration_ms: duration,
    timestamp:   new Date().toISOString(),
  })
}
