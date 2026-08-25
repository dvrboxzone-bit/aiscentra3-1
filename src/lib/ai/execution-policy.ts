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
  /** Models admitted by a lock-scoped preclaim plan. Others are skipped. */
  reservedModels?: readonly string[]
  /** Reassign unused earlier windows to later admitted fallbacks. */
  carryForwardUnusedTime?: boolean
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

export const TARGETED_SIS_V4_CLASSIFIER_POLICY: AIJSONExecutionPolicy = {
  ...TARGETED_SIS_V3_CLASSIFIER_POLICY,
  carryForwardUnusedTime: true,
}

export const TARGETED_SIS_V4_PARSER_POLICY: AIJSONExecutionPolicy = {
  ...TARGETED_SIS_V3_PARSER_POLICY,
  carryForwardUnusedTime: true,
}

export interface TargetedSisV4Model {
  provider: string
  model: string
}

export interface TargetedSisV4TPMCheck {
  allowed: boolean
  remainingTokens: number
}

export interface TargetedSisV4ReservationPlan {
  classifierModels: readonly string[]
  parserModels: readonly string[]
  reservedTokensByModel: Readonly<Record<string, number>>
}

export function buildLockScopedTPMAvailability(input: {
  models: readonly string[]
  rows: readonly unknown[]
  capacityForModel: (model: string) => number
}): ReadonlyMap<string, TargetedSisV4TPMCheck> | null {
  const requested = new Set(input.models)
  const used = new Map<string, number>()
  for (const row of input.rows) {
    if (!row || typeof row !== 'object') return null
    const model = (row as { model?: unknown }).model
    const tokens = (row as { tokens?: unknown }).tokens
    if (
      typeof model !== 'string' ||
      !requested.has(model) ||
      typeof tokens !== 'number' ||
      !Number.isInteger(tokens) ||
      tokens < 0
    ) {
      return null
    }
    used.set(model, (used.get(model) ?? 0) + tokens)
  }

  const availability = new Map<string, TargetedSisV4TPMCheck>()
  for (const model of requested) {
    const capacity = input.capacityForModel(model)
    if (!Number.isFinite(capacity) || capacity <= 0) return null
    availability.set(model, {
      allowed: true,
      remainingTokens: Math.max(0, capacity - (used.get(model) ?? 0)),
    })
  }
  return availability
}

/**
 * Builds a conservative reservation while the caller holds the durable
 * enrichment lease. The same 20b bucket is charged cumulatively when it is
 * considered for both classifier and parser; Cloudflare is required as one
 * provider-independent parser fallback.
 */
export function createTargetedSisV4ReservationPlan(input: {
  remainingMs: number
  lockLeaseVerified: boolean
  classifierChain: readonly TargetedSisV4Model[]
  parserChain: readonly TargetedSisV4Model[]
  estimatedTokens: number
  checkTPM: (model: string, estimatedTokens: number) => TargetedSisV4TPMCheck
}): TargetedSisV4ReservationPlan | null {
  if (
    !input.lockLeaseVerified ||
    input.remainingMs < TARGETED_SIS_V3_MINIMUM_CLAIM_WINDOW_MS ||
    input.estimatedTokens <= 0
  ) {
    return null
  }

  const classifier = input.classifierChain[0]
  const parser = input.parserChain[0]
  if (!classifier || !parser) return null

  const checks = new Map<string, TargetedSisV4TPMCheck>()
  const planned = new Map<string, number>()
  const canReserve = (model: string): boolean => {
    const check = checks.get(model) ?? input.checkTPM(model, input.estimatedTokens)
    checks.set(model, check)
    return (
      check.allowed && (planned.get(model) ?? 0) + input.estimatedTokens <= check.remainingTokens
    )
  }
  const reserve = (model: string): boolean => {
    if (!canReserve(model)) return false
    planned.set(model, (planned.get(model) ?? 0) + input.estimatedTokens)
    return true
  }

  if (!reserve(classifier.model) || !reserve(parser.model)) return null

  const parserModels = [parser.model]
  for (const fallback of input.parserChain.slice(1)) {
    // Preserve model order. A same-provider 20b fallback is admitted only if
    // its shared bucket still fits after the classifier reservation.
    if (fallback.provider === parser.provider) {
      if (reserve(fallback.model)) parserModels.push(fallback.model)
      continue
    }
    // Exactly one provider-independent fallback is mandatory.
    if (!reserve(fallback.model)) return null
    parserModels.push(fallback.model)
    return {
      classifierModels: [classifier.model],
      parserModels,
      reservedTokensByModel: Object.fromEntries(planned),
    }
  }

  return null
}
