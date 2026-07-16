/**
 * AIscentra — Signal Scoring Engine (Server-Side)
 *
 * Computes signal_score, confidence_score, momentum_score from raw factor scores.
 * Formulas from Signal Scoring Specification v1.0, Sections 05, 06, 07.
 *
 * CRITICAL: The AI agent returns raw factors (0–10).
 * Final scores are computed HERE — never by the agent directly.
 * This prevents agent score inflation (Signal Spec v1.0, Section 16.4).
 */

export interface RawFactors {
  // Signal Score factors (Section 05)
  impact_factor:              number  // 0–10
  actor_factor:               number  // 0–10
  novelty_factor:             number  // 0–10
  verifiability_factor:       number  // 0–10
  strategic_factor:           number  // 0–10
  // Confidence Score factors (Section 06)
  authority_factor:           number  // 0–10
  corroboration_factor:       number  // 0–10
  specificity_factor:         number  // 0–10
  category_confidence_factor: number  // 0–10
  consistency_factor:         number  // 0–10 (default 7 for first 30 days)
}

export interface ComputedScores {
  signal_score:     number  // 0–100 integer
  confidence_score: number  // 0–100 integer
}

/**
 * Compute signal_score from impact, actor, novelty, verifiability, strategic factors.
 * Formula: Signal Scoring Specification v1.0, Section 05.3
 *
 * signal_score = round(
 *   (impact×0.25 + actor×0.25 + novelty×0.20 + verifiability×0.15 + strategic×0.15) × 10
 * )
 */
export function computeSignalScore(f: Pick<RawFactors,
  'impact_factor' | 'actor_factor' | 'novelty_factor' |
  'verifiability_factor' | 'strategic_factor'
>): number {
  const raw =
    f.impact_factor        * 0.25 +
    f.actor_factor         * 0.25 +
    f.novelty_factor       * 0.20 +
    f.verifiability_factor * 0.15 +
    f.strategic_factor     * 0.15

  return Math.min(100, Math.max(0, Math.round(raw * 10)))
}

/**
 * Compute confidence_score from authority, corroboration, specificity,
 * category_confidence, consistency factors.
 * Formula: Signal Scoring Specification v1.0, Section 06.3
 *
 * confidence_score = round(
 *   (authority×0.30 + corroboration×0.25 + specificity×0.20 +
 *    category_confidence×0.15 + consistency×0.10) × 10
 * )
 *
 * Hard ceiling: if authority_factor ≤ 2, max confidence = 60 (Section 06.3)
 */
export function computeConfidenceScore(f: Pick<RawFactors,
  'authority_factor' | 'corroboration_factor' | 'specificity_factor' |
  'category_confidence_factor' | 'consistency_factor'
>): number {
  const raw =
    f.authority_factor           * 0.30 +
    f.corroboration_factor       * 0.25 +
    f.specificity_factor         * 0.20 +
    f.category_confidence_factor * 0.15 +
    f.consistency_factor         * 0.10

  let score = Math.min(100, Math.max(0, Math.round(raw * 10)))

  // Hard ceiling: low-authority sources cannot exceed 60
  if (f.authority_factor <= 2) {
    score = Math.min(60, score)
  }

  return score
}

/**
 * Compute momentum_score using exponential decay model.
 * Formula: Signal Scoring Specification v1.0, Section 07.3
 *
 * base_momentum = (new_observations × 8) + (distinct_sources × 12) + (cross_category × 10)
 * decay_factor  = e^(−0.05 × days_since_creation)
 * momentum_score = min(100, round(base_momentum × decay_factor))
 *
 * At creation: uses initial observation counts. Recalculated every 24h by scheduled job.
 */
export function computeMomentumScore(params: {
  newObservationsCount:   number
  distinctSourceCount:    number
  crossCategoryRefCount:  number
  daysSinceCreation:      number
}): number {
  const baseMomentum =
    params.newObservationsCount  * 8  +
    params.distinctSourceCount   * 12 +
    params.crossCategoryRefCount * 10

  const decayFactor = Math.exp(-0.05 * params.daysSinceCreation)
  return Math.min(100, Math.max(0, Math.round(baseMomentum * decayFactor)))
}

export function computeAllScores(factors: RawFactors): ComputedScores {
  return {
    signal_score:     computeSignalScore(factors),
    confidence_score: computeConfidenceScore(factors),
  }
}

/**
 * Validate that all factor scores are integers in 0–10 range.
 * Returns list of validation errors.
 */
export function validateFactors(factors: Partial<RawFactors>): string[] {
  const errors: string[] = []
  const keys: (keyof RawFactors)[] = [
    'impact_factor', 'actor_factor', 'novelty_factor',
    'verifiability_factor', 'strategic_factor', 'authority_factor',
    'corroboration_factor', 'specificity_factor',
    'category_confidence_factor', 'consistency_factor',
  ]

  for (const key of keys) {
    const val = factors[key]
    if (val === undefined || val === null) {
      errors.push(`Missing factor: ${key}`)
    } else if (!Number.isInteger(val) || val < 0 || val > 10) {
      errors.push(`Invalid factor ${key}: ${val} (must be integer 0–10)`)
    }
  }

  return errors
}
