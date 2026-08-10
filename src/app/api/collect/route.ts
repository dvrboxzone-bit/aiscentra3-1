/**
 * AIscentra — Collection API Route
 *
 * POST /api/collect
 * Body: { sourceId?: string } — specific source, or all if omitted
 *
 * Architecture (Readiness Assessment Blocker B-04):
 * Each source is collected in a separate invocation via sequential calls.
 * This keeps every function execution well within Vercel's 10s timeout.
 *
 * Called by: /api/cron/collect (scheduled), admin interface (manual trigger)
 *
 * Auth: requires CRON_SECRET header to prevent unauthorized triggers.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { collectSource } from '@/modules/observations/collector'
import type { Source } from '@/types/database'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

/**
 * How long a source stays excluded after an ERROR before being retried.
 * 6 hours: long enough that a source failing during one collection cycle
 * (currently every 4h once the GitHub-Actions-driven collection lands,
 * see /api/cron/collect's own docs) does not get hammered on the very
 * next cycle, short enough that a source is never stuck for the ~20 days
 * observed in production before this fix.
 */
const RETRY_COOLDOWN_HOURS = 6

function isAuthorized(request: Request): boolean {
  const secret = process.env['CRON_SECRET']
  if (!secret) return false // CRON_SECRET must be set in production
  const header = request.headers.get('x-cron-secret') ?? request.headers.get('authorization')
  return header === secret || header === `Bearer ${secret}`
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { sourceId?: string } = {}
  try {
    body = (await request.json()) as { sourceId?: string }
  } catch {
    // Empty body is valid — means collect all sources
  }

  const supabase = createAdminClient()

  // Fetch sources to collect: ACTIVE sources, PLUS ERROR sources whose
  // last check was long enough ago to retry.
  //
  // REAL BUG FIXED: this previously filtered `.eq('status','ACTIVE')`
  // only -- a source that flipped to ERROR even once was excluded from
  // EVERY future collection attempt forever, with no retry mechanism at
  // all. Confirmed against production: three sources (Anthropic News,
  // Meta AI Blog, Mistral AI Blog) sat in ERROR for ~20 days, their
  // last_checked_at frozen at the moment of the original failure --
  // proving nothing had attempted them since.
  //
  // A cooldown (not immediate retry) avoids hammering a source that is
  // GENUINELY down; a source is eligible again once RETRY_COOLDOWN_HOURS
  // has passed since the last attempt, regardless of how many times it
  // has failed before -- deliberately no permanent lockout tier, since a
  // feed URL or upstream outage can resolve itself and this project has
  // no human operator monitoring source health day to day.
  const retryCooldownCutoff = new Date(Date.now() - RETRY_COOLDOWN_HOURS * 3_600_000).toISOString()

  let query = supabase
    .from('sources')
    .select('*')
    .or(`status.eq.ACTIVE,and(status.eq.ERROR,last_checked_at.lt.${retryCooldownCutoff})`)

  if (body.sourceId) {
    query = query.eq('id', body.sourceId)
  }

  const { data: sources, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!sources || sources.length === 0) {
    return NextResponse.json({ message: 'No active sources found', results: [] })
  }

  // Collect each source sequentially within this request
  // For large source sets, the cron endpoint calls this per-source
  const results = []
  for (const source of sources as Source[]) {
    const result = await collectSource(source)
    results.push(result)
  }

  const summary = {
    sourcesProcessed: results.length,
    totalFetched: results.reduce((a, r) => a + r.fetched, 0),
    totalPassed: results.reduce((a, r) => a + r.passed, 0),
    totalSaved: results.reduce((a, r) => a + r.saved, 0),
    totalRejected: results.reduce((a, r) => a + r.rejected, 0),
    errors: results.filter((r) => r.error).map((r) => ({ source: r.sourceName, error: r.error })),
  }

  console.log('[collect] Summary:', JSON.stringify(summary))

  return NextResponse.json({ summary, results })
}
