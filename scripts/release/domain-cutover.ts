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
  | 'DOMAIN CUTOVER FAILED — ROLLBACK ATTEMPTED'
  | 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED'
  | 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED'

/**
 * Pure, deterministically testable content checks. These are the checks
 * that previously lived in the separate `post-promotion-smoke` job
 * (which ran AFTER domain-cutover had already succeeded and switched
 * both public domains, with no rollback wired to its own failures --
 * the confirmed defect this module now closes). They are pure functions
 * over already-fetched bytes/text/JSON, with no network or Vercel CLI
 * knowledge of their own, so they can be exercised directly by fast
 * unit tests with fixture data. The real network fetching that feeds
 * them lives in run-domain-cutover.ts's verifyDomain implementation,
 * which calls these functions and folds every result into the SAME
 * bounded verify-then-rollback loop below -- there is no longer any
 * check that can fail release without triggering rollback.
 */
export function checkRootContent(html: string): { ok: boolean; detail?: string } {
  if (!/aiscentra/i.test(html)) {
    return { ok: false, detail: 'root HTML did not contain recognizable AIscentra content' }
  }
  return { ok: true }
}

export function checkHealthJson(json: unknown): { ok: boolean; detail?: string } {
  const health = json as { status?: unknown; checks?: { database?: unknown } }
  if (health.status !== 'ok') {
    return {
      ok: false,
      detail: `health .status was ${JSON.stringify(health.status)}, expected "ok"`,
    }
  }
  if (health.checks?.database !== 'ok') {
    return {
      ok: false,
      detail: `health .checks.database was ${JSON.stringify(health.checks?.database)}, expected "ok"`,
    }
  }
  return { ok: true }
}

export function checkCommitSha(
  actualSha: unknown,
  expectedSha: string,
): { ok: boolean; detail?: string } {
  if (actualSha !== expectedSha) {
    return {
      ok: false,
      detail: `githubCommitSha mismatch: got ${String(actualSha)}, expected ${expectedSha}`,
    }
  }
  return { ok: true }
}

/** Extracts the `content` attribute of a `<meta property="og:image" ...>` tag, if present. */
export function extractOpenGraphImageUrl(html: string): string | null {
  const match = html.match(
    /<meta[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i,
  )
  if (match && match[1] !== undefined) return match[1]
  // Attribute order can be reversed (content before property) -- check that too.
  const reversed = html.match(
    /<meta[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:image["'][^>]*>/i,
  )
  return reversed && reversed[1] !== undefined ? reversed[1] : null
}

export function checkOpenGraphTagPresent(html: string): { ok: boolean; detail?: string } {
  const url = extractOpenGraphImageUrl(html)
  if (!url) {
    return { ok: false, detail: 'missing required og:image meta tag' }
  }
  return { ok: true, detail: url }
}

export function checkOpenGraphImageStatus(status: number): { ok: boolean; detail?: string } {
  if (status !== 200) {
    return { ok: false, detail: `Open Graph image returned HTTP ${status}, expected 200` }
  }
  return { ok: true }
}

export function checkOpenGraphImageContentType(contentType: string | null): {
  ok: boolean
  detail?: string
} {
  if (!contentType || !contentType.toLowerCase().startsWith('image/png')) {
    return {
      ok: false,
      detail: `Open Graph image content-type was ${String(contentType)}, expected image/png`,
    }
  }
  return { ok: true }
}

export function checkPngSignature(
  firstEightBytesHex: string,
  expectedHex: string,
): { ok: boolean; detail?: string } {
  if (firstEightBytesHex.toLowerCase() !== expectedHex.toLowerCase()) {
    return {
      ok: false,
      detail: `PNG signature mismatch: got ${firstEightBytesHex}, expected ${expectedHex}`,
    }
  }
  return { ok: true }
}

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
  /**
   * Domains whose rollback attempt itself failed -- i.e. the domain was
   * switched to the staged deployment, cutover then decided to roll it
   * back, but the rollback `setAlias` call itself did not succeed. Every
   * such domain requires manual operator recovery to its recorded
   * previousHolderDeploymentId. Empty whenever no rollback was needed or
   * every attempted rollback succeeded.
   */
  manualRecoveryDomains: Array<{ domain: string; previousHolderDeploymentId: string }>
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
          manualRecoveryDomains: [],
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
      const manualRecoveryDomains = computeManualRecoveryDomains(domainResults)
      return {
        status:
          manualRecoveryDomains.length > 0
            ? 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED'
            : 'DOMAIN CUTOVER FAILED — ROLLBACK ATTEMPTED',
        diagnostics: {
          stagedDeploymentId,
          targetCommitSha,
          domains: domainResults,
          verification: [],
          verifyAttempts: 0,
          manualRecoveryDomains,
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
    const manualRecoveryDomains = computeManualRecoveryDomains(domainResults)
    return {
      status:
        manualRecoveryDomains.length > 0
          ? 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED'
          : 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED',
      diagnostics: {
        stagedDeploymentId,
        targetCommitSha,
        domains: domainResults,
        verification,
        verifyAttempts: attempts,
        manualRecoveryDomains,
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
      manualRecoveryDomains: [],
    },
  }
}

/**
 * Item 10 of the required behavior: if a rollback attempt itself fails
 * for one domain, the OTHER domain's rollback must still be attempted
 * (already guaranteed by rollbackAssigned's plain for-loop, which never
 * breaks/returns early on an individual rollback failure), and the
 * overall result must surface a distinct, explicit failure status plus
 * the exact list of domains + previous-holder IDs that require manual
 * operator recovery.
 */
function computeManualRecoveryDomains(
  domainResults: DomainAliasResult[],
): Array<{ domain: string; previousHolderDeploymentId: string }> {
  return domainResults
    .filter((d) => d.rolledBack === true && d.rollbackSucceeded === false)
    .map((d) => ({
      domain: d.domain,
      // previousHolderDeploymentId is guaranteed non-null here: a domain
      // can only reach rolledBack === true after its holder was already
      // determined in the first loop (Invariant 1).
      previousHolderDeploymentId: d.previousHolderDeploymentId as string,
    }))
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
      manualRecoveryDomains: result.diagnostics.manualRecoveryDomains.map((m) => ({
        domain: m.domain,
        previousHolderDeploymentId: m.previousHolderDeploymentId,
      })),
    },
  }
}
