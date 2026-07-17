/**
 * AIscentra — Cron: Momentum Recalculation
 *
 * GET /api/cron/momentum
 * Schedule: 0 2 * * * (daily at 02:00 UTC)
 *
 * Recalculates momentum_score for all ACTIVE signals.
 * Formula: Signal Scoring Specification v1.0, Section 07.3
 *
 * Also triggers expiration check:
 * - momentum_score < 5 for 7 consecutive days → EXPIRED
 * - age > category expiration window → EXPIRED
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { computeMomentumScore } from '@/modules/signals/scoring'
import type { SignalCategory } from '@/types/database'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

// Category expiration windows (days) — Signal Scoring Spec v1.0, Section 04.3
const EXPIRATION_DAYS: Record<SignalCategory, number> = {
  RESEARCH:       90,
  MODELS:         60,
  COMPANIES:      45,
  INFRASTRUCTURE: 60,
  OPEN_SOURCE:    45,
  FUNDING:        30,
  REGULATION:     120,
  AGENTS:         45,
  HARDWARE:       90,
}

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Fetch all ACTIVE signals
  const { data: signals, error } = await supabase
    .from('signals')
    .select('id, category, created_at, momentum_score, observation_ids, metadata')
    .eq('status', 'ACTIVE')
    .limit(200)

  if (error) {
    console.error('[cron/momentum] Fetch error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!signals || signals.length === 0) {
    return NextResponse.json({ message: 'No active signals', updated: 0, expired: 0 })
  }

  let updated = 0
  let expired = 0

  const now = Date.now()

  for (const signal of signals) {
    const createdAt = new Date(signal.created_at as string).getTime()
    const daysSince = (now - createdAt) / 86400000
    const category  = signal.category as SignalCategory

    // Check age-based expiration
    const expirationDays = EXPIRATION_DAYS[category] ?? 60
    if (daysSince > expirationDays) {
      await supabase
        .from('signals')
        .update({
          status:            'EXPIRED',
          expiration_reason: `EXP-01: age ${daysSince.toFixed(0)} days exceeds ${expirationDays}-day window for ${category}`,
          expired_at:        new Date().toISOString(),
          updated_at:        new Date().toISOString(),
        })
        .eq('id', signal.id)
      expired++
      continue
    }

    // Recompute momentum with current observation count
    const observationCount = (signal.observation_ids as string[]).length
    const meta = signal.metadata as Record<string, unknown>
    const momentumCalc = meta['momentum_calculation'] as Record<string, number> | undefined

    const newMomentum = computeMomentumScore({
      newObservationsCount:   observationCount,
      distinctSourceCount:    momentumCalc?.['distinct_source_count'] ?? 1,
      crossCategoryRefCount:  momentumCalc?.['cross_category_ref_count'] ?? 0,
      daysSinceCreation:      daysSince,
    })

    // Check momentum-based expiration (< 5 for 7 days)
    // Simplified for MVP: if score drops to 0 and signal is old enough
    if (newMomentum < 5 && daysSince > 7) {
      await supabase
        .from('signals')
        .update({
          momentum_score:            newMomentum,
          momentum_last_calculated:  new Date().toISOString(),
          status:                    'EXPIRED',
          expiration_reason:         `EXP-02: momentum_score ${newMomentum} below threshold after ${daysSince.toFixed(0)} days`,
          expired_at:                new Date().toISOString(),
          updated_at:                new Date().toISOString(),
        })
        .eq('id', signal.id)
      expired++
      continue
    }

    // Update momentum score
    await supabase
      .from('signals')
      .update({
        momentum_score:           newMomentum,
        momentum_last_calculated: new Date().toISOString(),
        updated_at:               new Date().toISOString(),
      })
      .eq('id', signal.id)

    updated++
  }

  console.log(`[cron/momentum] updated=${updated} expired=${expired}`)

  return NextResponse.json({
    processed: signals.length,
    updated,
    expired,
    timestamp: new Date().toISOString(),
  })
}
