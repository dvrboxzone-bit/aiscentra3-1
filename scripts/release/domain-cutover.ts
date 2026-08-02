/**
 * AIscentra — Explicit Domain Cutover Helper (Phase 1C-B2 correction)
 *
 * Root cause this replaces: the previous release workflow relied on
 * `vercel promote` to implicitly move the two public production domains
 * (aiscentra.com / www.aiscentra.com) onto a newly staged deployment.
 * `vercel promote` can report success and mark a deployment `target:
 * "production"` internally without the public domain aliases actually
 * having moved -- confirmed empirically during a real release attempt:
 * `vercel promote` printed "Success!", but a subsequent bounded poll of
 * the promoted deployment's own `alias` field never showed either public
 * domain, and the previous deployment continued to hold both domains the
 * entire time. Promotion status and domain-alias assignment are two
 * separate Vercel-side facts and must be verified independently.
 *
 * This module contains ONLY the cutover decision logic. It has no
 * knowledge of the Vercel CLI, HTTP, or GitHub Actions -- every external
 * effect (reading the current alias holder, assigning an alias, the
 * final live HTTP verification) is injected as a plain async function,
 * so the whole decision tree is exercised by fast, deterministic unit
 * tests with no real network or subprocess calls.
 *
 * Invariants enforced here:
 *  1. Every domain's current holder must be unambiguously determined
 *     BEFORE any alias mutation is attempted. If any holder is
 *     undetermined, no alias command is ever called.
 *  2. If one domain's alias assignment succeeds and another's fails,
 *     the succeeded domain is immediately reassigned back to its
 *     recorded previous holder before the run reports failure.
 *  3. Even after every domain alias reports success, a fully
 *     independent, real check (final verification: expected commit SHA
 *     plus successful root/health/opengraph checks, injected as
 *     `verifyDomain`) must positively confirm the new deployment is
 *     actually being served on the domain before this is considered a
 *     success. If verification does not confirm within the bounded
 *     timeout, every domain is rolled back to its previous holder.
 *  4. The returned diagnostic object never contains tokens, auth
 *     headers, or raw Vercel API payloads -- only IDs, domain names,
 *     booleans, and short status strings.
 */

export type CutoverStatus =
  | 'CUTOVER_SUCCESS'
  | 'ABORTED_NO_HOLDER'
  | 'DOMAIN_CUTOVER_FAILED_ROLLBACK_ATTEMPTED'
  | 'PUBLIC_RELEASE_NOT_VERIFIED_ROLLBACK_ATTEMPTED'

export interface DomainAliasResult {
  domain: string
  previousHolderDeploymentId: string | null
  assignSucceeded: boolean | null
  assignError?: string | undefined
  rolledBack: boolean
  rollbackSucceeded: boolean | null
  rollbackError?: string | undefined
}

export interface DomainVerifyResult {
  domain: string
  ok: boolean
  detail?: string | undefined
}

export interface CutoverDiagnostics {
  stagedDeploymentId: string
  targetCommitSha: string
  domains: DomainAliasResult[]
  verification: DomainVerifyResult[]
  verifyAttempts: number
}

export interface CutoverResult {
  status: CutoverStatus
  diagnostics: CutoverDiagnostics
}

export interface GetCurrentHolderFn {
  (domain: string): Promise<string | null>
}

export interface SetAliasFn {
  (domain: string, deploymentId: string): Promise<{ ok: boolean; error?: string }>
}

export interface VerifyDomainFn {
  (domain: string, expectedCommitSha: string): Promise<{ ok: boolean; detail?: string }>
}

export interface SleepFn {
  (ms: number): Promise<void>
}

export interface PlanDomainCutoverInput {
  domains: string[]
  stagedDeploymentId: string
  targetCommitSha: string
  getCurrentHolder: GetCurrentHolderFn
  setAlias: SetAliasFn
  verifyDomain: VerifyDomainFn
  sleep: SleepFn
  verifyTimeoutMs?: number
  verifyIntervalMs?: number
}

const DEFAULT_VERIFY_TIMEOUT_MS = 60_000
const DEFAULT_VERIFY_INTERVAL_MS = 5_000

export async function planDomainCutover(input: PlanDomainCutoverInput): Promise<CutoverResult> {
  const {
    domains,
    stagedDeploymentId,
    targetCommitSha,
    getCurrentHolder,
    setAlias,
    verifyDomain,
    sleep,
    verifyTimeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
    verifyIntervalMs = DEFAULT_VERIFY_INTERVAL_MS,
  } = input

  const domainResults: DomainAliasResult[] = domains.map((domain) => ({
    domain,
    previousHolderDeploymentId: null,
    assignSucceeded: null,
    rolledBack: false,
    rollbackSucceeded: null,
  }))

  // Invariant 1: determine every domain's current holder BEFORE any
  // mutation. Any undetermined holder aborts the whole run with zero
  // alias commands issued.
  for (const result of domainResults) {
    const holder = await getCurrentHolder(result.domain)
    if (holder === null) {
      return {
        status: 'ABORTED_NO_HOLDER',
        diagnostics: {
          stagedDeploymentId,
          targetCommitSha,
          domains: domainResults,
          verification: [],
          verifyAttempts: 0,
        },
      }
    }
    result.previousHolderDeploymentId = holder
  }

  // Assign each domain to the staged deployment. Stop at the first
  // failure and roll back everything already assigned.
  for (const result of domainResults) {
    const assign = await setAlias(result.domain, stagedDeploymentId)
    result.assignSucceeded = assign.ok
    if (!assign.ok) {
      result.assignError = assign.error
      await rollbackAssigned(domainResults, setAlias)
      return {
        status: 'DOMAIN_CUTOVER_FAILED_ROLLBACK_ATTEMPTED',
        diagnostics: {
          stagedDeploymentId,
          targetCommitSha,
          domains: domainResults,
          verification: [],
          verifyAttempts: 0,
        },
      }
    }
  }

  // Invariant 3: independent, bounded, real verification of every
  // domain before declaring success.
  const verification: DomainVerifyResult[] = []
  let attempts = 0
  const deadline = Date.now() + verifyTimeoutMs

  let allVerified = false
  while (Date.now() < deadline) {
    attempts += 1
    verification.length = 0
    let attemptOk = true
    for (const domain of domains) {
      const v = await verifyDomain(domain, targetCommitSha)
      verification.push({ domain, ok: v.ok, detail: v.detail })
      if (!v.ok) attemptOk = false
    }
    if (attemptOk) {
      allVerified = true
      break
    }
    if (Date.now() + verifyIntervalMs < deadline) {
      await sleep(verifyIntervalMs)
    } else {
      break
    }
  }

  if (!allVerified) {
    await rollbackAssigned(domainResults, setAlias)
    return {
      status: 'PUBLIC_RELEASE_NOT_VERIFIED_ROLLBACK_ATTEMPTED',
      diagnostics: {
        stagedDeploymentId,
        targetCommitSha,
        domains: domainResults,
        verification,
        verifyAttempts: attempts,
      },
    }
  }

  return {
    status: 'CUTOVER_SUCCESS',
    diagnostics: {
      stagedDeploymentId,
      targetCommitSha,
      domains: domainResults,
      verification,
      verifyAttempts: attempts,
    },
  }
}

async function rollbackAssigned(
  domainResults: DomainAliasResult[],
  setAlias: SetAliasFn,
): Promise<void> {
  for (const result of domainResults) {
    if (result.assignSucceeded === true && result.previousHolderDeploymentId !== null) {
      result.rolledBack = true
      const rollback = await setAlias(result.domain, result.previousHolderDeploymentId)
      result.rollbackSucceeded = rollback.ok
      if (!rollback.ok) {
        result.rollbackError = rollback.error
      }
    }
  }
}

/**
 * Redacts a diagnostics object for safe inclusion in a workflow artifact.
 * The shape produced by planDomainCutover() already excludes tokens,
 * auth headers, and raw API payloads by construction (it only ever
 * carries domain names, deployment IDs, booleans, and short strings),
 * but this pass-through exists as an explicit, named assertion point:
 * any future field added to CutoverDiagnostics must be deliberately
 * routed through here, not silently included.
 */
export function toSafeArtifact(result: CutoverResult): CutoverResult {
  return {
    status: result.status,
    diagnostics: {
      stagedDeploymentId: result.diagnostics.stagedDeploymentId,
      targetCommitSha: result.diagnostics.targetCommitSha,
      domains: result.diagnostics.domains.map((d) => ({
        domain: d.domain,
        previousHolderDeploymentId: d.previousHolderDeploymentId,
        assignSucceeded: d.assignSucceeded,
        assignError: d.assignError,
        rolledBack: d.rolledBack,
        rollbackSucceeded: d.rollbackSucceeded,
        rollbackError: d.rollbackError,
      })),
      verification: result.diagnostics.verification.map((v) => ({
        domain: v.domain,
        ok: v.ok,
        detail: v.detail,
      })),
      verifyAttempts: result.diagnostics.verifyAttempts,
    },
  }
}
