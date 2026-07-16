/**
 * AIscentra — Cron: Observation Collection
 *
 * GET /api/cron/collect
 * Triggered by Vercel Cron every 4 hours (see vercel.json).
 *
 * Pattern (Blocker B-04 resolution):
 * Rather than processing all sources in one long function,
 * this endpoint fetches active source IDs and fires sequential
 * internal requests — each source gets its own execution context
 * and stays well within the 10s timeout.
 *
 * Vercel authenticates cron requests via Authorization: Bearer CRON_SECRET
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  // Vercel automatically sets Authorization header for cron jobs
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const appUrl   = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'
  const cronSecret = process.env['CRON_SECRET'] ?? ''

  // Get all active source IDs
  const { data: sources, error } = await supabase
    .from('sources')
    .select('id, name')
    .eq('status', 'ACTIVE')

  if (error) {
    console.error('[cron/collect] Failed to fetch sources:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!sources || sources.length === 0) {
    return NextResponse.json({ message: 'No active sources' })
  }

  // Fire collection requests per source — non-blocking (fire and forget)
  // Each request processes one source independently within its own timeout
  const triggered: string[] = []
  const failures:  string[] = []

  for (const source of sources) {
    try {
      // Fire but don't await — stays within cron's own 10s limit
      fetch(`${appUrl}/api/collect`, {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'x-cron-secret':  cronSecret,
        },
        body: JSON.stringify({ sourceId: source.id }),
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[cron/collect] Failed to trigger ${source.name}:`, msg)
      })
      triggered.push(source.name as string)
    } catch {
      failures.push(source.name as string)
    }
  }

  console.log(`[cron/collect] Triggered ${triggered.length} sources`)

  return NextResponse.json({
    triggered: triggered.length,
    failures:  failures.length,
    sources:   triggered,
    timestamp: new Date().toISOString(),
  })
}
