/**
 * AIscentra — Cron: Report Generation
 *
 * GET /api/cron/reports
 * Schedule: 0 6 * * * (daily at 06:00 UTC, after momentum at 02:00)
 *
 * Generates:
 * 1. Event Analysis for any new events without reports
 * 2. Weekly Review (Mondays only)
 * 3. One Trend Report (rotates through categories)
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl     = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'
  const cronSecret = process.env['CRON_SECRET'] ?? ''
  const supabase   = createAdminClient()

  const triggered: string[] = []

  const post = (body: object): void => {
    fetch(`${appUrl}/api/reports/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
      body:    JSON.stringify(body),
    }).catch((err: unknown) => {
      console.error('[cron/reports] Request failed:', err instanceof Error ? err.message : String(err))
    })
  }

  // 1. Event Analysis: find events without a report yet (last 48h)
  const since48h = new Date(Date.now() - 48 * 3600000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: events } = await (supabase as any)
    .from('events')
    .select('id')
    .gte('created_at', since48h)
    .limit(5)

  for (const event of events ?? []) {
    post({ type: 'EVENT_ANALYSIS', eventId: event.id })
    triggered.push(`EVENT_ANALYSIS:${event.id as string}`)
  }

  // 2. Weekly Review on Mondays (day 1)
  if (new Date().getDay() === 1) {
    post({ type: 'WEEKLY_REVIEW' })
    triggered.push('WEEKLY_REVIEW')
  }

  // 3. Trend Report: rotate through categories by day of month
  const TREND_CATEGORIES = [
    'MODELS', 'RESEARCH', 'COMPANIES', 'FUNDING',
    'AGENTS', 'REGULATION', 'INFRASTRUCTURE', 'OPEN_SOURCE', 'HARDWARE',
  ]
  const todayIndex = new Date().getDate() % TREND_CATEGORIES.length
  const trendCategory = TREND_CATEGORIES[todayIndex]
  if (trendCategory) {
    post({ type: 'TREND_REPORT', category: trendCategory })
    triggered.push(`TREND_REPORT:${trendCategory}`)
  }

  console.log(`[cron/reports] Triggered: ${triggered.join(', ')}`)

  return NextResponse.json({ triggered, timestamp: new Date().toISOString() })
}
