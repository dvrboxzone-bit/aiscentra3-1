/**
 * AIscentra — Cron: Daily Pipeline
 *
 * GET /api/cron/pipeline
 * Vercel Hobby: 1 cron job, daily at 10:00 UTC.
 * schedule: "0 10 * * *"
 *
 * Collection is NOT a step in this pipeline (removed -- see the inline
 * comment at the former Step 1 below for why). It is handled entirely
 * by .github/workflows/collect-4h.yml, 6x/day, independent of this
 * once-daily Vercel-cron-triggered route. One of those 6 GitHub Actions
 * cycles runs at 09:00 UTC, an hour before this pipeline, so freshly-
 * collected observations already exist by the time enrich/batch below
 * runs.
 *
 * reports remains fire-and-forget (nothing downstream depends on its
 * completion within this run). enrich/batch is genuinely awaited
 * (bounded, see ENRICH_AWAIT_TIMEOUT_MS below) before events fires --
 * confirmed race condition: events previously fired via fire-and-forget
 * immediately after enrich/batch, with no guarantee any of that run's
 * newly-created signals had been committed yet, which is one of the
 * reasons Event Engine saw nothing to group.
 *   - /api/enrich/batch     → maxDuration 60s (Signal Engine) — AWAITED,
 *     bounded by ENRICH_AWAIT_TIMEOUT_MS so this route's own duration
 *     stays predictable regardless of enrich/batch's internal budget
 *   - /api/cron/events      → maxDuration 60s (Event Engine) — now runs
 *     only after the awaited enrich/batch call above settles
 *   - /api/cron/reports     → maxDuration 60s (Report Engine, daily,
 *     fire-and-forget)
 *
 * NOTE: momentum is a separate, independently-scheduled concern and is
 * intentionally not fired from this pipeline (see /api/cron/momentum's
 * own docs for its trigger).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Bounded wait for enrich/batch's response. enrich/batch's own internal
// TIME_BUDGET (54s) is unchanged by this task. This route's own
// maxDuration (60s) is the same ceiling already proven to deploy
// successfully elsewhere in this project (enrich/batch itself uses
// maxDuration=60) -- not raised beyond that empirically-confirmed value.
// THROUGHPUT FIX: previously 40_000ms, budgeted for "15s collect-wait +
// up to 40s enrich/batch await" -- since the collect step and its 15s
// wait were removed from this route entirely (see this file's top
// docstring), that budget is now available to enrich/batch instead.
// Raised to 52_000ms: close to enrich/batch's own full internal 54s
// TIME_BUDGET, leaving ~8s of this route's 60s ceiling for its own
// overhead (auth check, the fetch call itself, firing events/reports).
const ENRICH_AWAIT_TIMEOUT_MS = 52_000

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env['CRON_SECRET']

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use production domain — NEXT_PUBLIC_APP_URL must be set to https://aiscentra.com in Vercel env
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'
  const log: string[] = []

  const headers = {
    'Content-Type': 'application/json',
    'x-cron-secret': cronSecret,
  }

  // Step 1: Collect -- REMOVED (this was the 7th automatic collection
  // trigger). Before this fix, this pipeline fired /api/collect once,
  // in addition to .github/workflows/collect-4h.yml's own 6
  // GitHub-Actions-driven cycles/day (see that workflow for the full
  // rationale) -- one of which is already scheduled at 09:00 UTC,
  // 60 minutes before THIS pipeline's own 10:00 UTC run, specifically
  // so collection is fresh before enrichment runs. Firing /api/collect
  // again here made the true daily collection count 7, not 6 as
  // intended, and duplicated work the 09:00 GitHub Actions cycle had
  // already done moments earlier. collect-4h.yml is now the sole
  // automatic trigger for collection; this pipeline's job is
  // enrich -> events -> reports only.
  log.push('collect: skipped (handled by collect-4h.yml, 6x/day)')

  // Step 2 (was "wait for collect to write observations") — REMOVED
  // along with Step 1's collect call above. No longer anything to wait
  // for here specifically; freshly-collected observations already exist
  // from the 09:00 UTC GitHub Actions collection cycle (see this file's
  // top docstring).

  // Step 3: Enrich batch (Signal Engine) — genuinely awaited, bounded.
  // Race condition fix: events (Step 4) must not fire before any signals
  // created by this run's enrich/batch call are committed. A bounded
  // timeout (not an unbounded await) keeps this route's own duration
  // predictable even if enrich/batch runs its full internal budget.
  try {
    const enrichResp = await fetch(`${appUrl}/api/enrich/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(ENRICH_AWAIT_TIMEOUT_MS),
    })
    log.push(`enrich/batch: awaited, status=${enrichResp.status}`)
  } catch (e: unknown) {
    // Timeout or network failure -- proceed to events regardless; this
    // is a bounded wait, not a hard dependency gate.
    log.push(`enrich/batch: await failed or timed out (${String(e)})`)
    console.error('[pipeline] enrich/batch await failed:', e)
  }

  // Step 4: Event Engine (processes promoted signals)
  fetch(`${appUrl}/api/cron/events`, {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  }).catch((e: unknown) => console.error('[pipeline] events:', e))
  log.push('events: fired')

  // Step 5: Reports (daily brief)
  fetch(`${appUrl}/api/cron/reports`, {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  }).catch((e: unknown) => console.error('[pipeline] reports:', e))
  log.push('reports: fired')

  return NextResponse.json({
    status: 'pipeline_fired',
    timestamp: new Date().toISOString(),
    log,
  })
}
