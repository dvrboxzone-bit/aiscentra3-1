/**
 * AIscentra — Cron: Daily Pipeline
 *
 * GET /api/cron/pipeline
 * Vercel Hobby: 1 cron job, daily at 10:00 UTC.
 * schedule: "0 10 * * *"
 *
 * Fires sub-requests non-blocking (fire-and-forget).
 * Each runs in its own Vercel invocation:
 *   - /api/collect          → maxDuration 10s
 *   - /api/enrich/batch     → maxDuration 60s (Signal Engine)
 *   - /api/cron/events      → maxDuration 60s (Event Engine)
 *   - /api/cron/momentum    → maxDuration 60s (Momentum update)
 *   - /api/cron/reports     → maxDuration 60s (Report Engine, daily)
 */
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30
export const dynamic     = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env['CRON_SECRET']

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra3-1.vercel.app'
  const log: string[] = []

  const headers = {
    'Content-Type':  'application/json',
    'x-cron-secret': cronSecret,
  }

  // Step 1: Collect
  fetch(`${appUrl}/api/collect`, {
    method: 'POST', headers, body: JSON.stringify({}),
  }).catch((e: unknown) => console.error('[pipeline] collect:', e))
  log.push('collect: fired')

  // Step 2: Wait for collect to write observations
  await new Promise(r => setTimeout(r, 15_000))

  // Step 3: Enrich batch (Signal Engine)
  fetch(`${appUrl}/api/enrich/batch`, {
    method: 'POST', headers, body: JSON.stringify({}),
  }).catch((e: unknown) => console.error('[pipeline] enrich/batch:', e))
  log.push('enrich/batch: fired')

  // Step 4: Event Engine (processes promoted signals)
  fetch(`${appUrl}/api/cron/events`, {
    method: 'GET',
    headers: { 'authorization': `Bearer ${cronSecret}` },
  }).catch((e: unknown) => console.error('[pipeline] events:', e))
  log.push('events: fired')

  // Step 5: Reports (daily brief)
  fetch(`${appUrl}/api/cron/reports`, {
    method: 'GET',
    headers: { 'authorization': `Bearer ${cronSecret}` },
  }).catch((e: unknown) => console.error('[pipeline] reports:', e))
  log.push('reports: fired')

  return NextResponse.json({
    status:    'pipeline_fired',
    timestamp: new Date().toISOString(),
    log,
  })
}
