/**
 * AIscentra — Cron: Daily Pipeline
 *
 * GET /api/cron/pipeline
 * Vercel Hobby: 1 cron job, daily at 10:00 UTC.
 * schedule: "0 10 * * *"
 *
 * collect and reports remain fire-and-forget (nothing downstream depends
 * on their completion within this run). enrich/batch is now genuinely
 * awaited (bounded, see ENRICH_AWAIT_TIMEOUT_MS below) before events
 * fires -- confirmed race condition: events previously fired via
 * fire-and-forget immediately after enrich/batch, with no guarantee any
 * of that run's newly-created signals had been committed yet, which is
 * one of the reasons Event Engine saw nothing to group.
 *   - /api/collect          → maxDuration 10s (fire-and-forget)
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
// Budget: 15s collect-wait + up to 40s enrich/batch await + small
// overhead for firing events/reports stays safely under 60s even in the
// worst case, rather than waiting for enrich/batch's full internal 54s
// budget (which combined with the 15s collect-wait would exceed 60s).
const ENRICH_AWAIT_TIMEOUT_MS = 40_000

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

  // Step 1: Collect
  fetch(`${appUrl}/api/collect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  }).catch((e: unknown) => console.error('[pipeline] collect:', e))
  log.push('collect: fired')

  // Step 2: Wait for collect to write observations
  await new Promise((r) => setTimeout(r, 15_000))

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
