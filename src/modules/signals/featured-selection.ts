/**
 * AIscentra — Featured Signal Selection (homepage)
 *
 * Pure selection logic, decoupled from the database, so it can be
 * unit-tested deterministically. getFeaturedSignals() in queries.ts is
 * a thin wrapper that fetches candidates and calls this.
 *
 * Rules (owner task, Part 3; refined per owner follow-up on the
 * priority-cascade interpretation):
 * 1. Target count: 6 (within the requested 5-7 range) — scarcity is a
 *    deliberate signal of value, not a limitation to work around.
 * 2. Tier priority, used as a FALLBACK-FILL cascade, not an exclusive
 *    filter: Strong (81-100) fills first; if that doesn't reach the
 *    target count, Signal (61-80) fills next; Weak (41-60) is only
 *    added if the combined Strong+Signal count is still below 5.
 *    CONFIRMED by owner: this fallback-fill reading is correct over the
 *    alternative ("show ONLY Strong whenever any exist") — the
 *    alternative would frequently leave the homepage showing far fewer
 *    than 5-7 signals given the current score distribution (0 signals
 *    currently score >=81).
 * 2a. ABSOLUTE tier order is guaranteed: category diversity (rule 5,
 *    below) is applied STRICTLY WITHIN each tier and can never cause a
 *    lower-tier (e.g. Signal) candidate to be placed ahead of a
 *    higher-tier (e.g. Strong) candidate that hasn't been placed yet.
 *    Each tier is fully processed, in order, before the next tier's
 *    candidates are even considered -- diversity can reorder within a
 *    tier's own candidates, never across a tier boundary.
 * 3. Anything scoring below 40 is never included, at any tier.
 * 4. Within a tier, newest first (by created_at).
 * 5. Category diversity: no more than 2 consecutive signals from the
 *    same category, applied within a single tier only (see 2a). This is
 *    a soft preference, not a hard filter — if honoring it would
 *    require dropping a real signal with no remaining in-tier
 *    alternative, the constraint is relaxed rather than losing content.
 * 6. Fewer than 3 qualifying signals overall -> show nothing from this
 *    function; the caller renders a placeholder instead.
 */
import type { Signal } from '@/types/database'

export const FEATURED_TARGET_COUNT = 6
export const MIN_SIGNALS_FOR_PLACEHOLDER = 3
const STRONG_MIN = 81
const SIGNAL_MIN = 61
const WEAK_MIN = 41

function byNewestFirst(a: Signal, b: Signal): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

/**
 * Fills `result` (mutated in place) from `tierCandidates` only, up to
 * `targetCount` total, enforcing "no more than 2 consecutive same
 * category" as a soft preference scoped to THIS tier's own candidates.
 * Never reaches outside `tierCandidates` -- this is what guarantees
 * rule 2a: a lower tier's candidates are never even visible to this
 * function while an earlier tier is still being filled.
 */
function fillTierWithDiversity(
  tierCandidates: Signal[],
  result: Signal[],
  targetCount: number,
): void {
  const remaining = [...tierCandidates]

  while (result.length < targetCount && remaining.length > 0) {
    const lastTwo = result.slice(-2)
    const violates = (s: Signal): boolean =>
      lastTwo.length === 2 && lastTwo.every((r) => r.category === s.category)

    let pickIndex = remaining.findIndex((s) => !violates(s))
    if (pickIndex === -1) {
      // Every remaining candidate IN THIS TIER would violate the
      // constraint -- relax it for this one placement rather than
      // losing a real signal. Still never pulls from another tier.
      pickIndex = 0
    }

    const [picked] = remaining.splice(pickIndex, 1)
    if (picked) result.push(picked)
  }
}

/**
 * Selects and orders signals for homepage display from a pool of
 * already-fetched candidates (any status/score mix is fine -- this
 * function does all the filtering). Returns an empty array when fewer
 * than MIN_SIGNALS_FOR_PLACEHOLDER qualifying signals exist; the caller
 * is responsible for rendering the placeholder in that case.
 */
export function selectFeaturedSignals(
  allSignals: Signal[],
  targetCount: number = FEATURED_TARGET_COUNT,
): Signal[] {
  const strong = allSignals.filter((s) => s.signal_score >= STRONG_MIN).sort(byNewestFirst)
  const mid = allSignals
    .filter((s) => s.signal_score >= SIGNAL_MIN && s.signal_score < STRONG_MIN)
    .sort(byNewestFirst)
  const weak = allSignals
    .filter((s) => s.signal_score >= WEAK_MIN && s.signal_score < SIGNAL_MIN)
    .sort(byNewestFirst)
  // Anything scoring below WEAK_MIN (40) is never a candidate at all.

  const primaryCount = strong.length + mid.length
  const includeWeak = primaryCount < 5
  const totalQualifying = primaryCount + (includeWeak ? weak.length : 0)

  if (totalQualifying < MIN_SIGNALS_FOR_PLACEHOLDER) {
    return []
  }

  const result: Signal[] = []
  fillTierWithDiversity(strong, result, targetCount)
  fillTierWithDiversity(mid, result, targetCount)
  if (includeWeak) fillTierWithDiversity(weak, result, targetCount)

  return result
}
