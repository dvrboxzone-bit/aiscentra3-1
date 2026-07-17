/**
 * AIscentra — Event Promotion API
 *
 * POST /api/events/promote
 * Body: { signalId?: string } — specific signal, or next eligible
 *
 * Processes ONE signal per call to stay within 10s timeout.
 * Called by: /api/cron/events (scheduled), admin (manual trigger)
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { processSignalIntoEvent } from '@/modules/events/engine'
import {
  fetchEligibleSignals,
  checkPromotionEligibility,
  checkRateLimits,
} from '@/modules/events/promotion'
import type { Signal } from '@/types/database'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

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

  let body: { signalId?: string } = {}
  try { body = (await request.json()) as { signalId?: string } } catch { /* empty body ok */ }

  const supabase = createAdminClient()
  let signal: Signal | null = null

  if (body.signalId) {
    const { data } = await supabase
      .from('signals')
      .select('*')
      .eq('id', body.signalId)
      .single()
    signal = data as Signal | null
  } else {
    const eligible = await fetchEligibleSignals(1)
    signal = eligible[0] ?? null
  }

  if (!signal) {
    return NextResponse.json({ message: 'No eligible signals for promotion' })
  }

  // Re-verify eligibility
  const eligCheck = checkPromotionEligibility(signal)
  if (!eligCheck.eligible) {
    return NextResponse.json({
      message: 'Signal not eligible',
      reason:  eligCheck.reason,
      signalId: signal.id,
    })
  }

  // Check rate limits
  const rateCheck = await checkRateLimits(signal.category)
  if (!rateCheck.allowed) {
    return NextResponse.json({
      message:       'Rate limit reached',
      categoryCount: rateCheck.categoryCount,
      totalCount:    rateCheck.totalCount,
    })
  }

  const result = await processSignalIntoEvent(signal)

  return NextResponse.json(result)
}
