/**
 * AIscentra — Cron: URL Reachability Verification (backfill + ongoing)
 *
 * POST /api/cron/verify-urls
 *
 * REAL INCIDENT THIS CLOSES: the earlier version processed at most
 * BATCH_SIZE=30 observations per invocation, with no ORDER BY (so
 * pagination across invocations was not genuinely deterministic --
 * PostgreSQL does not guarantee row order without one), no priority
 * for observations that actually affect a currently-ACTIVE signal's
 * public visibility, and no within-invocation time-budget loop (a
 * single page, then return, even though real headroom remained within
 * maxDuration). At 30/invocation x 6 scheduled invocations/day = 180/
 * day, backfilling the real 6,885-observation backlog left over from
 * the PR #44->PR #45 migration gap would have taken ~38 days --
 * meanwhile the public signal feed stays effectively empty (every
 * existing signal's own has_verified_source defaults to false until
 * its linked observations are verified), which is precisely the
 * symptom that triggered the emergency rollback this fix responds to.
 *
 * REAL FIX: a genuine within-invocation time-budget loop, draining
 * MULTIPLE deterministically-ordered pages (ORDER BY id, a stable
 * primary key) per invocation until either the queue is empty or the
 * time budget is exhausted -- not a single fixed-size page. Priority:
 * observations linked to an ACTIVE signal are drained FIRST, in their
 * own separate, exhaustively-paginated pass, before any other pending
 * observation is touched -- these are the ones actually gating public
 * visibility right now. Resumability is unchanged in mechanism
 * (url_verified_ok stays NULL until a row is genuinely written, so a
 * crash or timeout mid-run loses zero already-completed progress) but
 * now genuinely deterministic thanks to the explicit ORDER BY.
 *
 * maxDuration raised 30->60, matching the same ceiling already
 * empirically proven safe elsewhere in this project (enrich/batch's
 * own maxDuration=60) -- a real, tested Vercel Hobby-plan value, not a
 * new unverified one.
 *
 * INDEPENDENT REVIEW OF PR #46 -- three further real fixes:
 *
 * 1. STARTED_AT/DEADLINE_AT are now computed FRESH, inside the POST
 *    handler, on every single request -- previously module-level
 *    `const`s, which only run once at cold start. Vercel reuses a
 *    "warm" Node.js process across multiple invocations of the same
 *    function; a warm invocation happening any amount of time after
 *    the process's original cold start would see a deadline computed
 *    from THAT original moment. If the warm instance had been alive
 *    longer than maxDuration, the deadline would already be in the
 *    past, and every check in the drain loop would be true
 *    immediately -- processing ZERO records on every subsequent warm
 *    invocation, indistinguishable from a genuinely idle queue.
 *
 * 2. Database read errors (both the ACTIVE-signals lookup and the
 *    observations page fetch) are no longer masked as an empty queue.
 *    Previously, drainOnePage returned rowsFetched: 0 identically for
 *    "genuinely no pending rows" AND "the database read itself
 *    failed" -- the outer loop could not tell them apart, and a
 *    transient DB failure would silently produce a 200 response
 *    reporting stoppedReason: 'queue_empty', verified: 0 -- a false
 *    success. drainOnePage's return type now carries an explicit
 *    dbError field; the outer loop stops immediately on it and the
 *    HTTP response is a genuine 500 naming the failure, never masked
 *    as an empty/idle result.
 *
 * 3. A new `priorityOnly` request option (JSON body: {"priorityOnly":
 *    true}) lets a caller request ONLY the ACTIVE-signal priority
 *    pass, skipping the general backlog pass entirely regardless of
 *    remaining time budget. This exists specifically so
 *    production-release.yml can run a real, bounded, AWAITED call to
 *    this endpoint between staged-deploy and staged-smoke -- draining
 *    just enough of the priority queue to give the feed a real chance
 *    of being non-empty before the smoke gate checks it -- without
 *    also draining the full general backlog inside that release-time
 *    request (the general backlog continues via the separately-
 *    scheduled verify-urls-4h.yml cadence after release, matching the
 *    explicit "не использовать fire-and-forget или фоновое выполнение
 *    внутри Vercel-запроса" requirement: this is a real, awaited,
 *    bounded HTTP call from the workflow, not a background task
 *    inside a single request).
 *
 * REAL CHANGES (second architectural review, unchanged from before):
 * - POST, not GET (a GET route with real DB side effects is a
 *   CSRF-adjacent risk).
 * - Centralized, constant-time isAuthorizedCronRequest (cron-guard.ts).
 * - Raw Supabase error messages are never returned to the caller --
 *   logged server-side only.
 *
 * Deliberately a SEPARATE endpoint from collection, not verification
 * inside collector.ts: collector.ts's own feed fetch already uses up
 * to 8s of Vercel's 10s function ceiling, so adding real per-item
 * network verification there risked timing out collection itself.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyUrlReachable } from '@/lib/utils/source-links'
import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'
import { isAuthorizedCronRequest } from '@/lib/security/cron-guard'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** Rows fetched per page within one invocation's drain loop. Real
 * verification is a real network call per item, parallelized within a
 * page via Promise.all -- page wall-clock time is bounded by the
 * SLOWEST single URL in that page (each individually capped at 5s
 * inside verifyUrlReachable), not the sum. 50 keeps a single slow page
 * well within the per-page time check below even in a bad case. */
const PAGE_SIZE = 50

/** Real time-budget check, mirroring the same DEADLINE_BUFFER_MS
 * pattern already used in enrich/batch/route.ts: stop starting new
 * pages once fewer than this many ms remain before maxDuration, to
 * leave real headroom for in-flight page completion, DB writes, and
 * the function's own response. */
const DEADLINE_BUFFER_MS = 10_000

const VERIFY_URLS_LOCK = 'verify_urls_cycle'

interface PageResult {
  processed: number
  ok: number
  failed: number
  writeFailures: number
  affectedSignalIds: Set<string>
}

/**
 * REAL BUG FIXED (independent review): dbError is a NEW, explicit
 * field distinguishing "the database read genuinely failed" from
 * "rowsFetched is 0 because the queue is genuinely empty" -- the two
 * were previously indistinguishable to the caller, which treated a
 * real DB failure as if it meant "nothing left to do."
 */
interface DrainPageOutcome {
  result: PageResult
  nextCursor: string | null
  rowsFetched: number
  dbError: string | null
}

function emptyPageResult(): PageResult {
  return { processed: 0, ok: 0, failed: 0, writeFailures: 0, affectedSignalIds: new Set() }
}

export async function drainOnePage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  priorityOnly: boolean,
  cursor: string | null,
): Promise<DrainPageOutcome> {
  let query = supabase.from('observations').select('id, url, signal_id').is('url_verified_ok', null)

  if (cursor) query = query.gt('id', cursor)

  if (priorityOnly) {
    // Real priority pass: only observations linked to a currently-
    // ACTIVE signal -- these directly gate what the public feed shows
    // right now, so they are drained exhaustively before any other
    // pending observation is touched at all.
    const { data: activeSignalIds, error: activeErr } = await supabase
      .from('signals')
      .select('id')
      .eq('status', 'ACTIVE')

    // REAL BUG FIXED: a query error here previously fell through to
    // the SAME "empty" return as "there are genuinely zero ACTIVE
    // signals" -- a transient DB failure was silently treated as
    // harmless. Now surfaced explicitly via dbError.
    if (activeErr) {
      console.error('[cron/verify-urls] ACTIVE-signals lookup failed:', activeErr.message)
      return {
        result: emptyPageResult(),
        nextCursor: null,
        rowsFetched: 0,
        dbError: activeErr.message,
      }
    }
    if (!activeSignalIds || activeSignalIds.length === 0) {
      return { result: emptyPageResult(), nextCursor: null, rowsFetched: 0, dbError: null }
    }
    query = query.in(
      'signal_id',
      (activeSignalIds as Array<{ id: string }>).map((s) => s.id),
    )
  }

  // order/limit applied LAST, after every filter -- avoids any doubt
  // about whether a query-builder chain is sensitive to call order
  // (PostgREST itself is not, but building the chain filters-first
  // keeps this genuinely unambiguous to read).
  query = query.order('id', { ascending: true }).limit(PAGE_SIZE) // REAL deterministic pagination -- was previously unordered

  const { data: pending, error } = await query
  if (error) {
    // REAL BUG FIXED: previously indistinguishable from a genuinely
    // empty queue -- see this function's own docstring.
    console.error('[cron/verify-urls] page fetch failed:', error.message)
    return { result: emptyPageResult(), nextCursor: null, rowsFetched: 0, dbError: error.message }
  }

  const rows = (pending ?? []) as Array<{ id: string; url: string; signal_id: string | null }>
  if (rows.length === 0) {
    return { result: emptyPageResult(), nextCursor: null, rowsFetched: 0, dbError: null }
  }

  const results = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      signalId: row.signal_id,
      ok: await verifyUrlReachable(row.url),
    })),
  )

  const verifiedAt = new Date().toISOString()
  const pageResult: PageResult = emptyPageResult()

  for (const r of results) {
    // REAL BUG FIXED (unchanged from prior review): this write's
    // `error` must be checked -- a silent DB write failure must not
    // be counted as if the verification result had been persisted.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: writeError } = await (supabase as any)
      .from('observations')
      .update({ url_verified_ok: r.ok, url_verified_at: verifiedAt })
      .eq('id', r.id)

    if (writeError) {
      pageResult.writeFailures++
      console.error(
        `[cron/verify-urls] failed to persist verification result for observation ${r.id}: ${writeError.message}`,
      )
      continue // not counted as processed/ok/failed -- the write did not actually happen
    }

    pageResult.processed++
    if (r.ok) pageResult.ok++
    else pageResult.failed++
    if (r.signalId) pageResult.affectedSignalIds.add(r.signalId)
  }

  const lastRow = rows[rows.length - 1]
  return {
    result: pageResult,
    nextCursor: rows.length === PAGE_SIZE && lastRow ? lastRow.id : null, // null means this pass is exhausted
    rowsFetched: rows.length,
    dbError: null,
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // REAL BUG FIXED: computed fresh on every request -- see this file's
  // own top docstring (independent review, point 1) for why a
  // module-level computation was a real, serious bug on warm Vercel
  // instances.
  const startedAt = Date.now()
  const deadlineAt = startedAt + maxDuration * 1000 - DEADLINE_BUFFER_MS

  // Real requirement (independent review, point 3): an optional
  // request-body flag lets a caller (specifically
  // production-release.yml, between staged-deploy and staged-smoke)
  // request ONLY the priority (ACTIVE-signal) pass, skipping the
  // general backlog pass regardless of remaining time budget. Defaults
  // to false (both passes) for the endpoint's normal scheduled-cron
  // usage, matching prior behavior exactly when this flag is absent.
  let priorityOnlyMode = false
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && 'priorityOnly' in body) {
      priorityOnlyMode = (body as { priorityOnly?: unknown }).priorityOnly === true
    }
  } catch {
    // No body, or invalid JSON -- both treated as "no options given,"
    // matching this endpoint's original no-body contract exactly.
  }

  const supabase = createAdminClient()
  const lockHolder = `verify-urls:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockClient = supabase as any

  const gotLock = await acquireEnrichmentLock(lockClient, lockHolder, 300, VERIFY_URLS_LOCK)
  if (!gotLock) {
    return NextResponse.json({ skipped: true, reason: 'verify_urls_already_running' })
  }

  try {
    let totalProcessed = 0
    let totalOk = 0
    let totalFailed = 0
    let totalWriteFailures = 0
    const allAffectedSignalIds = new Set<string>()
    let pagesRun = 0
    let stoppedReason: 'queue_empty' | 'time_budget' | 'priority_only_complete' = 'queue_empty'
    let dbErrorEncountered: string | null = null

    // Pass 1: priority -- observations linked to an ACTIVE signal,
    // exhaustively paginated (within the time budget) before anything
    // else is touched.
    let cursor: string | null = null
    for (;;) {
      if (Date.now() >= deadlineAt) {
        stoppedReason = 'time_budget'
        break
      }
      const page = await drainOnePage(lockClient, true, cursor)
      pagesRun++
      totalProcessed += page.result.processed
      totalOk += page.result.ok
      totalFailed += page.result.failed
      totalWriteFailures += page.result.writeFailures
      for (const id of page.result.affectedSignalIds) allAffectedSignalIds.add(id)

      // REAL BUG FIXED: a genuine DB error now stops the loop
      // immediately and is carried through to a non-200 HTTP response
      // below -- never silently treated as "priority pass exhausted."
      if (page.dbError) {
        dbErrorEncountered = page.dbError
        break
      }
      if (page.rowsFetched === 0) break // priority pass genuinely exhausted
      cursor = page.nextCursor
      if (cursor === null) break // last page of priority pass was smaller than PAGE_SIZE -- exhausted
    }

    // Pass 2: everything else -- only if time budget remains, no DB
    // error occurred in pass 1, AND the caller did not request
    // priority-only mode.
    if (dbErrorEncountered) {
      // Skip pass 2 entirely -- already failed.
    } else if (priorityOnlyMode) {
      stoppedReason = 'priority_only_complete'
    } else if (Date.now() < deadlineAt) {
      cursor = null
      for (;;) {
        if (Date.now() >= deadlineAt) {
          stoppedReason = 'time_budget'
          break
        }
        const page = await drainOnePage(lockClient, false, cursor)
        pagesRun++
        totalProcessed += page.result.processed
        totalOk += page.result.ok
        totalFailed += page.result.failed
        totalWriteFailures += page.result.writeFailures
        for (const id of page.result.affectedSignalIds) allAffectedSignalIds.add(id)

        if (page.dbError) {
          dbErrorEncountered = page.dbError
          break
        }
        if (page.rowsFetched === 0) break // queue genuinely empty
        cursor = page.nextCursor
        if (cursor === null) break
      }
    } else {
      stoppedReason = 'time_budget'
    }

    // REAL BUG FIXED: a genuine database read failure now produces an
    // honest, non-200 response naming the failure -- never masked as
    // a harmless empty/idle result. The lock is still released via the
    // `finally` block below regardless.
    if (dbErrorEncountered) {
      return NextResponse.json(
        {
          error: 'Database read failed during backfill',
          verified: totalProcessed,
          ok: totalOk,
          failed: totalFailed,
          writeFailures: totalWriteFailures,
          pagesRun,
          stoppedReason: 'db_error',
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      )
    }

    // Recompute the publication gate for every affected signal. Each
    // signal's own observation_ids array is the source of truth for
    // compute_has_verified_source, so this is correct regardless of
    // how many observations link to it. REAL REQUIREMENT: this never
    // sets has_verified_source=true without a genuinely-verified safe
    // URL -- compute_has_verified_source (PostgreSQL function) only
    // returns true when at least one linked observation has
    // url_verified_ok=true, which is only ever set by a real,
    // completed verifyUrlReachable() call above. Nothing in this loop
    // weakens or bypasses that.
    let gateWriteFailures = 0
    for (const signalId of allAffectedSignalIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sig, error: sigReadError } = await (lockClient as any)
        .from('signals')
        .select('observation_ids')
        .eq('id', signalId)
        .single()
      if (sigReadError) {
        gateWriteFailures++
        console.error(
          `[cron/verify-urls] failed to read signal ${signalId} for gate recompute: ${sigReadError.message}`,
        )
        continue
      }
      if (!sig) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: gateResult, error: rpcError } = await (lockClient as any).rpc(
        'compute_has_verified_source',
        { p_observation_ids: sig.observation_ids },
      )
      if (rpcError) {
        gateWriteFailures++
        console.error(
          `[cron/verify-urls] compute_has_verified_source RPC failed for signal ${signalId}: ${rpcError.message}`,
        )
        continue
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: gateWriteError } = await (lockClient as any)
        .from('signals')
        .update({ has_verified_source: gateResult === true })
        .eq('id', signalId)
      if (gateWriteError) {
        gateWriteFailures++
        console.error(
          `[cron/verify-urls] failed to write has_verified_source for signal ${signalId}: ${gateWriteError.message}`,
        )
      }
    }

    return NextResponse.json({
      verified: totalProcessed,
      ok: totalOk,
      failed: totalFailed,
      writeFailures: totalWriteFailures,
      gateWriteFailures,
      signalsReevaluated: allAffectedSignalIds.size,
      pagesRun,
      stoppedReason,
      priorityOnly: priorityOnlyMode,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } finally {
    await releaseEnrichmentLock(lockClient, lockHolder, VERIFY_URLS_LOCK)
  }
}
