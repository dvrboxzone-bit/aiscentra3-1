/**
 * AIscentra — Cron: Event Promotion
 *
 * GET /api/cron/events
 * Schedule: 45 */4 * * * (45 mins after collection, 15 after enrichment)
 * Fires per-signal promotion requests non-blocking.
 */
import { NextResponse } from 'next/server'
import { fetchEligibleSignals } from '@/modules/events/promotion'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl     = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'
  const cronSecret = process.env['CRON_SECRET'] ?? ''

  const eligible = await fetchEligibleSignals(20)

  if (eligible.length === 0) {
    return NextResponse.json({ message: 'No eligible signals', triggered: 0 })
  }

  let triggered = 0
  for (const signal of eligible) {
    fetch(`${appUrl}/api/events/promote`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify({ signalId: signal.id }),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron/events] Failed to trigger promotion for ${signal.id}:`, msg)
    })
    triggered++
  }

  console.log(`[cron/events] Triggered ${triggered} promotions`)

  return NextResponse.json({
    triggered,
    timestamp: new Date().toISOString(),
  })
}
