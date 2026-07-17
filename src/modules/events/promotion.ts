/**
 * AIscentra — Signal Promotion Engine
 *
 * Implements promotion rules from Signal Scoring Specification v1.0, Section 09.
 *
 * Automatic promotion requires ALL conditions simultaneously:
 * 1. signal_score ≥ 70
 * 2. confidence_score ≥ 65
 * 3. status = ACTIVE
 * 4. No open validation flags
 * 5. Signal age ≤ 7 days
 * 6. Minimum 4-hour delay since creation (anti-flood)
 *
 * Rate limits: max 20 per category per 24h, max 60 total per 24h.
 */
import { createAdminClient } from '@/lib/supabase/server'
import type { Signal } from '@/types/database'

export const PROMOTION_THRESHOLDS = {
  SIGNAL_SCORE:     70,
  CONFIDENCE_SCORE: 65,
  MAX_AGE_DAYS:      7,
  MIN_DELAY_HOURS:   4,
  MAX_PER_CATEGORY: 20,
  MAX_TOTAL:        60,
} as const

export interface PromotionCandidate {
  signal: Signal
  eligibleReason: string
}

export interface PromotionCheck {
  eligible: boolean
  reason: string
}

// ── Eligibility Check ─────────────────────────────────────────────────────────

export function checkPromotionEligibility(signal: Signal): PromotionCheck {
  if (signal.status !== 'ACTIVE') {
    return { eligible: false, reason: `status is ${signal.status}, not ACTIVE` }
  }

  if (signal.signal_score < PROMOTION_THRESHOLDS.SIGNAL_SCORE) {
    return {
      eligible: false,
      reason: `signal_score ${signal.signal_score} < ${PROMOTION_THRESHOLDS.SIGNAL_SCORE}`,
    }
  }

  if (signal.confidence_score < PROMOTION_THRESHOLDS.CONFIDENCE_SCORE) {
    return {
      eligible: false,
      reason: `confidence_score ${signal.confidence_score} < ${PROMOTION_THRESHOLDS.CONFIDENCE_SCORE}`,
    }
  }

  if (signal.validation_flags.length > 0) {
    return {
      eligible: false,
      reason: `has open validation flags: ${signal.validation_flags.join(', ')}`,
    }
  }

  const ageMs   = Date.now() - new Date(signal.created_at).getTime()
  const ageDays  = ageMs / (1000 * 60 * 60 * 24)
  const ageHours = ageMs / (1000 * 60 * 60)

  if (ageDays > PROMOTION_THRESHOLDS.MAX_AGE_DAYS) {
    return {
      eligible: false,
      reason: `signal age ${ageDays.toFixed(1)} days exceeds ${PROMOTION_THRESHOLDS.MAX_AGE_DAYS}-day window`,
    }
  }

  if (ageHours < PROMOTION_THRESHOLDS.MIN_DELAY_HOURS) {
    return {
      eligible: false,
      reason: `signal age ${ageHours.toFixed(1)}h < ${PROMOTION_THRESHOLDS.MIN_DELAY_HOURS}h minimum delay`,
    }
  }

  return {
    eligible: true,
    reason: `score=${signal.signal_score} conf=${signal.confidence_score}`,
  }
}

// ── Rate Limit Check ──────────────────────────────────────────────────────────

export async function checkRateLimits(category: string): Promise<{
  allowed: boolean
  categoryCount: number
  totalCount: number
}> {
  const supabase  = createAdminClient()
  const since24h  = new Date(Date.now() - 86400000).toISOString()

  const [categoryResult, totalResult] = await Promise.all([
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('manual_override', false)
      .gte('created_at', since24h)
      // Join via signal category — simplified: count events from signals of this category
      // Full implementation uses a join; for MVP we approximate with total limit only
    ,
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('manual_override', false)
      .gte('created_at', since24h),
  ])

  const categoryCount = categoryResult.count ?? 0
  const totalCount    = totalResult.count    ?? 0

  const allowed =
    categoryCount < PROMOTION_THRESHOLDS.MAX_PER_CATEGORY &&
    totalCount    < PROMOTION_THRESHOLDS.MAX_TOTAL

  return { allowed, categoryCount, totalCount }
}

// ── Fetch Eligible Signals ────────────────────────────────────────────────────

export async function fetchEligibleSignals(limit = 10): Promise<Signal[]> {
  const supabase  = createAdminClient()
  const cutoff    = new Date(Date.now() - PROMOTION_THRESHOLDS.MAX_AGE_DAYS * 86400000).toISOString()
  const minDelay  = new Date(Date.now() - PROMOTION_THRESHOLDS.MIN_DELAY_HOURS * 3600000).toISOString()

  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .eq('status', 'ACTIVE')
    .gte('signal_score', PROMOTION_THRESHOLDS.SIGNAL_SCORE)
    .gte('confidence_score', PROMOTION_THRESHOLDS.CONFIDENCE_SCORE)
    .gte('created_at', cutoff)           // Not older than 7 days
    .lte('created_at', minDelay)         // At least 4 hours old
    .eq('validation_flags', '{}')        // No open flags
    .order('signal_score', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[promotion] fetchEligibleSignals error:', error.message)
    return []
  }

  return (data ?? []) as Signal[]
}

// ── Mark Signal as Promoted ───────────────────────────────────────────────────

export async function markSignalPromoted(
  signalId: string,
  eventId: string,
): Promise<void> {
  const supabase = createAdminClient()

  await supabase
    .from('signals')
    .update({
      status:     'PROMOTED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', signalId)
}
