export interface AIJSONExecutionPolicy {
  /** One bounded provider call per model for the v3 control checkpoint. */
  maxRetriesPerModel: number
  /** Per-chain-position provider/TPM window. */
  modelAttemptBudgetsMs: readonly number[]
  /** Time preserved after this role for later stages and durable writes. */
  reserveAfterChainMs: number
  /** A bounded pause before fallback; never consumes a fallback reservation. */
  maxFallbackBackoffMs: number
  stage: string
}

export const TARGETED_SIS_V3_CLASSIFIER_POLICY: AIJSONExecutionPolicy = {
  maxRetriesPerModel: 0,
  modelAttemptBudgetsMs: [4_000, 4_000, 4_000],
  reserveAfterChainMs: 31_000,
  maxFallbackBackoffMs: 250,
  stage: 'sis_classifier',
}

export const TARGETED_SIS_V3_PARSER_POLICY: AIJSONExecutionPolicy = {
  maxRetriesPerModel: 0,
  modelAttemptBudgetsMs: [9_000, 9_000, 9_000],
  reserveAfterChainMs: 4_000,
  maxFallbackBackoffMs: 250,
  stage: 'enrichment_parser',
}

export const TARGETED_SIS_V3_MINIMUM_CLAIM_WINDOW_MS = 47_000
export const TARGETED_SIS_V3_PREFLIGHT_ESTIMATED_TOKENS = 6_000

export function hasTargetedSisV3PreclaimBudget(input: {
  remainingMs: number
  classifierTPMAllowed: boolean
  parserTPMAllowed: boolean
}): boolean {
  return (
    input.remainingMs >= TARGETED_SIS_V3_MINIMUM_CLAIM_WINDOW_MS &&
    input.classifierTPMAllowed &&
    input.parserTPMAllowed
  )
}

export function reservedTimeAfterModel(policy: AIJSONExecutionPolicy, modelIndex: number): number {
  return (
    policy.reserveAfterChainMs +
    policy.modelAttemptBudgetsMs.slice(modelIndex + 1).reduce((total, budget) => total + budget, 0)
  )
}
