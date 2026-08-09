/**
 * AIscentra — Cron: Observation Collection
 *
 * GET /api/cron/collect
 *
 * Triggered by GitHub Actions (.github/workflows/collect-4h.yml), every 4
 * hours, NOT by a Vercel cron entry -- Vercel's Hobby plan allows exactly
 * ONE scheduled cron job per project, already used by
 * .github/workflows/enrich-batch-hourly.yml's counterpart for enrichment
 * (which itself moved off Vercel cron for the same reason). vercel.json's
 * single cron entry stays reserved for /api/cron/pipeline's daily run.
 *
 * The docstring here previously claimed "Vercel Cron every 4 hours" while
 * no such cron entry existed anywhere in vercel.json -- this endpoint was
 * unreachable by any automatic trigger at all. Confirmed against
 * production: real collection frequency was once/day (via
 * /api/cron/pipeline's fire-and-forget call to /api/collect), not every
 * 4 hours as check_interval_hours on every source implied.
 *
 * Pattern (Blocker B-04 resolution):
 * Rather than processing all sources in one long function,
 * this endpoint fetches active source IDs and fires sequential
 * internal requests — each source gets its own execution context
 * and stays well within the 10s timeout. With 9 sources currently
 * configured, a single sequential loop (as /api/collect's own
 * no-sourceId path does) risks exceeding Vercel's 10s ceiling at the
 * worst case of 8s per source; dispatching one fire-and-forget request
 * per source here avoids that entirely.
 *
 * Vercel authenticates cron requests via Authorization: Bearer CRON_SECRET
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'
import { recordCycleMetrics } from '@/lib/metrics'

// THROUGHPUT/CORRECTNESS FIX: was 10 (matching the old fire-and-forget
// pattern, which never actually waited for anything). Now that this
// route genuinely awaits all per-source /api/collect calls in parallel
// before releasing the execution lock, the real ceiling is bounded by
// the SLOWEST single /api/collect invocation's own maxDuration (10,
// see that route) plus this route's own HTTP round-trip overhead to
// call it. 30 gives real headroom above that nested 10s ceiling,
// matching the same "safe multiple above a nested call's own ceiling"
// pattern already used by /api/cron/pipeline (maxDuration=60, wrapping
// enrich/batch's own 60s internal budget plus overhead).
export const maxDuration = 30
export const dynamic = 'force-dynamic'

/** Same cooldown as /api/collect's own selection -- see that file's
 * docstring for the full rationale (a source that failed once must not
 * be excluded forever, but must not be hammered immediately either). */
const RETRY_COOLDOWN_HOURS = 6

/**
 * Distinct lock name from enrichment's own ('enrichment_cycle', see
 * execution-lock.ts) -- collection and enrichment are independent
 * operations (collection writes NEW observations, enrichment reads
 * UNPROCESSED ones) and do not need to be mutually exclusive. This
 * guards only against two COLLECTION cycles overlapping each other
 * (e.g. a manual dispatch racing the schedule), which is not otherwise
 * dangerous -- observations upsert on URL with ignoreDuplicates -- but
 * wastes fetches against the same 9 source feeds twice.
 */
const COLLECTION_LOCK = 'collection_cycle'

export async function GET(request: Request): Promise<NextResponse> {
  // Vercel automatically sets Authorization header for cron jobs
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'
  const cronSecret = process.env['CRON_SECRET'] ?? ''
  const startedAt = Date.now()

  const lockHolder = `cron-collect:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockClient = supabase as any
  const gotLock = await acquireEnrichmentLock(lockClient, lockHolder, 300, COLLECTION_LOCK)
  if (!gotLock) {
    return NextResponse.json({
      skipped: true,
      reason: 'collection_already_running',
      timestamp: new Date().toISOString(),
    })
  }

  try {
    // REAL BUG FIXED: previously `.eq('status','ACTIVE')` only -- a source
    // that ever flipped to ERROR was excluded from this list forever,
    // confirmed against production (three sources stuck ~20 days). Now
    // includes ERROR sources whose last attempt was long enough ago to
    // retry.
    const retryCooldownCutoff = new Date(
      Date.now() - RETRY_COOLDOWN_HOURS * 3_600_000,
    ).toISOString()
    const { data: sources, error } = await supabase
      .from('sources')
      .select('id, name')
      .or(`status.eq.ACTIVE,and(status.eq.ERROR,last_checked_at.lt.${retryCooldownCutoff})`)
      .returns<{ id: string; name: string }[]>()

    if (error) {
      console.error('[cron/collect] Failed to fetch sources:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!sources || sources.length === 0) {
      return NextResponse.json({ message: 'No sources due for collection' })
    }

    // Fire collection requests per source, IN PARALLEL, and genuinely
    // wait for all of them to settle before this function returns (and
    // therefore before the execution lock in the finally block below is
    // released).
    //
    // REAL BUG FIXED: previously each fetch() was called WITHOUT await
    // inside this loop -- the loop moved to the next source immediately,
    // this function returned right after, and the lock was released
    // almost instantly, well before any of the fire-and-forget requests
    // had actually finished. The lock's own purpose (preventing two
    // collection cycles from racing the same 9 source feeds) was
    // defeated in practice: a second cycle starting even a few seconds
    // later would see the lock already free.
    //
    // Fired in PARALLEL (not sequentially awaited one at a time) so
    // total wall-clock stays bounded by the SLOWEST individual source's
    // own internal timeout (collectSource's 8s AbortSignal.timeout, see
    // collector.ts) rather than the SUM of all 9 sources' timeouts --
    // sequential awaiting would risk exceeding this route's own
    // maxDuration by itself.
    const dispatched = sources.map(async (source) => {
      try {
        const res = await fetch(`${appUrl}/api/collect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-secret': cronSecret,
          },
          body: JSON.stringify({ sourceId: source.id }),
        })
        return { name: source.name, ok: res.ok, status: res.status }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[cron/collect] Failed to collect ${source.name}:`, msg)
        return { name: source.name, ok: false, status: 0, error: msg }
      }
    })

    const results = await Promise.all(dispatched)
    const triggered = results.filter((r) => r.ok).map((r) => r.name)
    const dispatchFailures = results.filter((r) => !r.ok).map((r) => r.name)

    console.log(`[cron/collect] Completed ${triggered.length}/${sources.length} sources`)

    // Real, persisted metrics -- previously this data existed only in
    // this HTTP response body, never queryable after the fact.
    // Failure breakdown keyed by the actual HTTP status observed per
    // source, since collector.ts's own richer per-source error detail
    // (HTTP status / parse error / insert error) is already recorded
    // separately on each source's own metadata by updateSourceStatus.
    const failureBreakdown: Record<string, number> = {}
    for (const r of results) {
      if (!r.ok) {
        const key = `http_${r.status || 'network_error'}`
        failureBreakdown[key] = (failureBreakdown[key] ?? 0) + 1
      }
    }
    await recordCycleMetrics(lockClient, {
      cycleType: 'collection',
      startedAt,
      completedAt: Date.now(),
      itemsAttempted: sources.length,
      itemsSucceeded: triggered.length,
      itemsFailed: dispatchFailures.length,
      failureBreakdown,
      stoppedReason: dispatchFailures.length > 0 ? 'partial_source_failures' : 'completed',
    })

    return NextResponse.json({
      triggered: triggered.length,
      failures: dispatchFailures.length,
      sources: triggered,
      timestamp: new Date().toISOString(),
    })
  } finally {
    // Always released, including on an unexpected throw. Even if this
    // never runs (process killed mid-flight), the lease expires on its
    // own -- same reasoning as enrich/batch's own use of this mechanism.
    await releaseEnrichmentLock(lockClient, lockHolder, COLLECTION_LOCK)
  }
}
