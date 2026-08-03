/**
 * AIscentra — Featured Signal Selection (homepage)
 *
 * Pure selection logic, decoupled from the database, so it can be
 * unit-tested deterministically. getFeaturedSignals() in queries.ts is
 * a thin wrapper that fetches candidates and calls this.
 *
 * Rules (owner task, Part 3):
 * 1. Target count: 6 (within the requested 5-7 range) — scarcity is a
 *    deliberate signal of value, not a limitation to work around.
 * 2. Tier priority, used as a FALLBACK-FILL cascade, not an exclusive
 *    filter: Strong (81-100) fills first; if that doesn't reach the
 *    target count, Signal (61-80) fills next; Weak (41-60) is only
 *    added if the combined Strong+Signal count is still below 5. This
 *    interpretation is an explicit assumption (see report) — the
 *    alternative reading ("show ONLY Strong signals whenever any exist,
 *    regardless of count") would frequently leave the homepage showing
 *    far fewer than 5-7 signals given current score distribution
 *    (0 signals currently score >=81), contradicting the stated goal
 *    of a populated, non-empty homepage.
 * 3. Anything scoring below 40 is never included, at any tier.
 * 4. Within a tier, newest first (by created_at).
 * 5. Category diversity: no more than 2 consecutive signals from the
 *    same category. This is a soft preference, not a hard filter — if
 *    honoring it would require dropping a real signal with no
 *    remaining alternative, the constraint is relaxed rather than
 *    losing content.
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
 * Enforces "no more than 2 consecutive signals from the same category"
 * as a soft preference. At each step, scans the remaining candidates
 * (in priority order) for the first one that would NOT violate the
 * constraint against the last two already-placed signals. If every
 * remaining candidate would violate it (no alternative exists), the
 * constraint is relaxed for that one placement rather than dropping a
 * real signal -- re-checked at every single placement, including ones
 * made after an earlier relaxation, so a violation is never silently
 * reintroduced by a later backfill step.
 */
function applyCategoryDiversity(candidates: Signal[], targetCount: number): Signal[] {
  const remaining = [...candidates]
  const result: Signal[] = []

  while (result.length < targetCount && remaining.length > 0) {
    const lastTwo = result.slice(-2)
    const violates = (s: Signal): boolean =>
      lastTwo.length === 2 && lastTwo.every((r) => r.category === s.category)

    let pickIndex = remaining.findIndex((s) => !violates(s))
    if (pickIndex === -1) {
      // Every remaining candidate would violate the constraint -- no
      // alternative exists, so relax it for this one placement rather
      // than losing a real signal.
      pickIndex = 0
    }

    const [picked] = remaining.splice(pickIndex, 1)
    if (picked) result.push(picked)
  }

  return result
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

  const primary = [...strong, ...mid]
  const candidateOrder = primary.length < 5 ? [...primary, ...weak] : primary

  if (candidateOrder.length < MIN_SIGNALS_FOR_PLACEHOLDER) {
    return []
  }

  return applyCategoryDiversity(candidateOrder, targetCount)
}
