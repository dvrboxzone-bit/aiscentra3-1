/**
 * AIscentra — Explicit Domain Cutover Helper
 *
 * Replaces `vercel promote` (which can report success while the public
 * domain aliases never move) with an explicit, bounded, reconciled,
 * rollback-protected cutover of aiscentra.com / www.aiscentra.com.
 *
 * This module contains ONLY decision logic. Every external effect
 * (reading a domain's actual current holder, assigning an alias, the
 * live verification) is injected as a plain async function, so the
 * whole decision tree is exercised by fast, deterministic unit tests
 * with no real network or subprocess calls.
 *
 * Invariants enforced here:
 *
 *  1. Every domain's current holder is determined BEFORE any alias
 *     mutation. If any holder is undetermined, zero alias commands are
 *     issued and the run aborts.
 *
 *  2. Holders are tracked PER DOMAIN and never assumed shared. Each
 *     domain rolls back to its own recorded previous holder.
 *
 *  3. RECONCILIATION (never trust a single exit code): after every
 *     alias-set attempt -- success, error, OR timeout -- the domain's
 *     ACTUAL holder is re-read. A CLI error or timeout does NOT prove
 *     the server did not apply the mutation, so rollback eligibility is
 *     decided by the observed holder, not by the command's exit status.
 *     A domain observed holding the staged deployment is always rolled
 *     back, even if its own assign call reported failure.
 *
 *  4. BOUNDED: the caller supplies an absolute deadline and a separate,
 *     reserved rollback budget. Verification may never consume the
 *     rollback reserve, so a hung verification can still be followed by
 *     a real rollback attempt.
 *
 *  5. ROLLBACK CONFIRMATION: rollbackSucceeded is set true only after
 *     re-reading the holder and observing the domain actually back on
 *     its own previous holder. A successful alias-set exit code alone
 *     is never sufficient. Conversely a rollback command that timed out
 *     but is observed to have taken effect is recorded as succeeded.
 *
 *  6. Unknown or unexpected holders are never silently accepted: they
 *     are surfaced in manualRecoveryDomains for operator action.
 *
 *  7. Diagnostics carry ONLY sanitized, length-capped, structured
 *     values -- never tokens, argv, raw Error.message, stdout, stderr,
 *     or nested causes. See sanitizeError() below.
 */

// --------------------------------------------------------------------
// Sanitization
// --------------------------------------------------------------------

/**
 * Structured, safe error codes. Runtime failures are classified into
 * one of these instead of carrying any raw text from the failing
 * operation. This is an allow-list by construction: a value that is not
 * one of these codes can never reach the artifact.
 */
export type SafeErrorCode =
  | 'TIMEOUT'
  | 'COMMAND_FAILED'
  | 'HTTP_STATUS'
  | 'CONTENT_MISMATCH'
  | 'BODY_TOO_LARGE'
  | 'PARSE_FAILED'
  | 'HOLDER_UNDETERMINED'
  | 'UNEXPECTED_HOLDER'
  | 'UNKNOWN'

/** Maximum length of any free-form diagnostic value in the artifact. */
export const MAX_DETAIL_LENGTH = 200

/**
 * Central sanitizer. EVERY runtime error must pass through this before
 * being stored or printed.
 *
 * Deliberately does NOT read err.message, err.stack, err.cause,
 * err.stdout, err.stderr, err.cmd, or any other property that Node's
 * child_process populates with the full command line (which historically
 * leaked the token passed via argv -- now additionally prevented at the
 * source by never putting the token in argv at all). Only the error's
 * *shape* is inspected, to distinguish a timeout from other failures.
 */
export function sanitizeError(err: unknown, fallback: SafeErrorCode = 'UNKNOWN'): SafeErrorCode {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown; killed?: unknown; signal?: unknown }
    if (
      e.name === 'AbortError' ||
      e.name === 'TimeoutError' ||
      e.code === 'ETIMEDOUT' ||
      e.killed === true ||
      e.signal === 'SIGTERM' ||
      e.signal === 'SIGKILL'
    ) {
      return 'TIMEOUT'
    }
  }
  return fallback
}

/**
 * Caps and strips any free-form detail string. Only ever applied to
 * strings this module itself constructed from already-safe, structured
 * inputs (status codes, domain names, deployment IDs) -- never to text
 * originating from an external process or remote response.
 */
export function safeDetail(code: SafeErrorCode, context?: string): string {
  const base = context ? `${code}: ${context}` : code
  return base.length > MAX_DETAIL_LENGTH ? base.slice(0, MAX_DETAIL_LENGTH) : base
}

// --------------------------------------------------------------------
// Types
// --------------------------------------------------------------------

export type CutoverStatus =
  | 'CUTOVER_SUCCESS'
  | 'ABORTED_NO_HOLDER'
  | 'DOMAIN CUTOVER FAILED — ROLLBACK ATTEMPTED'
  | 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED'
  | 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED'

/** Classification of a domain's actual, re-read holder. */
export type HolderState = 'HOLDS_STAGED' | 'HOLDS_PREVIOUS' | 'HOLDS_UNEXPECTED' | 'HOLDER_UNKNOWN'

export interface DomainAliasResult {
  domain: string
  previousHolderDeploymentId: string | null
  /** Exit status of the forward alias-set command. Informational only. */
  assignCommandOk: boolean | null
  /** Reconciled holder observed AFTER the forward alias attempt. */
  observedStateAfterAssign: HolderState | null
  assignErrorCode?: SafeErrorCode | undefined
  rolledBack: boolean
  /** True ONLY after re-reading the holder and confirming restoration. */
  rollbackSucceeded: boolean | null
  rollbackErrorCode?: SafeErrorCode | undefined
  /** Reconciled holder observed AFTER the rollback attempt. */
  observedStateAfterRollback?: HolderState | undefined
}

export interface DomainVerifyResult {
  domain: string
  ok: boolean
  detail?: string | undefined
}

export interface ManualRecoveryEntry {
  domain: string
  previousHolderDeploymentId: string | null
  observedState: HolderState
}

export interface CutoverDiagnostics {
  stagedDeploymentId: string
  targetCommitSha: string
  domains: DomainAliasResult[]
  verification: DomainVerifyResult[]
  verifyAttempts: number
  manualRecoveryDomains: ManualRecoveryEntry[]
}

export interface CutoverResult {
  status: CutoverStatus
  diagnostics: CutoverDiagnostics
}

/** Returns the deployment ID actually holding `domain`, or null. */
export interface GetCurrentHolderFn {
  (domain: string, timeoutMs: number): Promise<string | null>
}

export interface SetAliasFn {
  (
    domain: string,
    deploymentId: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; errorCode?: SafeErrorCode }>
}

export interface VerifyDomainFn {
  (
    domain: string,
    expectedCommitSha: string,
    timeoutMs: number,
    stagedDeploymentId: string,
  ): Promise<{ ok: boolean; detail?: string | undefined }>
}

export interface SleepFn {
  (ms: number): Promise<void>
}

export interface NowFn {
  (): number
}

export interface PlanDomainCutoverInput {
  domains: string[]
  stagedDeploymentId: string
  targetCommitSha: string
  getCurrentHolder: GetCurrentHolderFn
  setAlias: SetAliasFn
  verifyDomain: VerifyDomainFn
  sleep: SleepFn
  /** Injectable clock so deadline behavior is testable with fake timers. */
  now?: NowFn
  /** Total wall-clock budget for the whole transaction. */
  totalBudgetMs?: number
  /** Reserved exclusively for rollback; verification may never use it. */
  rollbackReserveMs?: number
  /** Per-operation timeout for a single alias set / holder read. */
  operationTimeoutMs?: number
  verifyIntervalMs?: number
}

const DEFAULT_TOTAL_BUDGET_MS = 300_000
const DEFAULT_ROLLBACK_RESERVE_MS = 120_000
const DEFAULT_OPERATION_TIMEOUT_MS = 60_000
const DEFAULT_VERIFY_INTERVAL_MS = 5_000

// --------------------------------------------------------------------
// Reconciliation
// --------------------------------------------------------------------

/**
 * Re-reads the domain's ACTUAL holder and classifies it. Never trusts a
 * previous command's exit code.
 */
export async function reconcileHolder(
  domain: string,
  stagedDeploymentId: string,
  previousHolderDeploymentId: string | null,
  getCurrentHolder: GetCurrentHolderFn,
  timeoutMs: number,
): Promise<HolderState> {
  let holder: string | null
  try {
    holder = await getCurrentHolder(domain, timeoutMs)
  } catch {
    return 'HOLDER_UNKNOWN'
  }
  if (holder === null) return 'HOLDER_UNKNOWN'
  if (holder === stagedDeploymentId) return 'HOLDS_STAGED'
  if (previousHolderDeploymentId !== null && holder === previousHolderDeploymentId) {
    return 'HOLDS_PREVIOUS'
  }
  return 'HOLDS_UNEXPECTED'
}

// --------------------------------------------------------------------
// Main
// --------------------------------------------------------------------

export async function planDomainCutover(input: PlanDomainCutoverInput): Promise<CutoverResult> {
  const {
    domains,
    stagedDeploymentId,
    targetCommitSha,
    getCurrentHolder,
    setAlias,
    verifyDomain,
    sleep,
    now = () => Date.now(),
    totalBudgetMs = DEFAULT_TOTAL_BUDGET_MS,
    rollbackReserveMs = DEFAULT_ROLLBACK_RESERVE_MS,
    operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    verifyIntervalMs = DEFAULT_VERIFY_INTERVAL_MS,
  } = input

  const startedAt = now()
  const absoluteDeadline = startedAt + totalBudgetMs
  // Verification must stop early enough that the reserve is untouched.
  const verifyDeadline = absoluteDeadline - rollbackReserveMs

  /** Remaining time for a non-rollback operation, capped per-operation. */
  const budgetFor = (deadline: number): number =>
    Math.max(0, Math.min(operationTimeoutMs, deadline - now()))

  const domainResults: DomainAliasResult[] = domains.map((domain) => ({
    domain,
    previousHolderDeploymentId: null,
    assignCommandOk: null,
    observedStateAfterAssign: null,
    rolledBack: false,
    rollbackSucceeded: null,
  }))

  const build = (
    status: CutoverStatus,
    verification: DomainVerifyResult[],
    verifyAttempts: number,
    manualRecoveryDomains: ManualRecoveryEntry[],
  ): CutoverResult => ({
    status,
    diagnostics: {
      stagedDeploymentId,
      targetCommitSha,
      domains: domainResults,
      verification,
      verifyAttempts,
      manualRecoveryDomains,
    },
  })

  // --- Invariant 1: determine every holder BEFORE any mutation. ------
  for (const result of domainResults) {
    let holder: string | null
    try {
      holder = await getCurrentHolder(result.domain, budgetFor(verifyDeadline))
    } catch {
      holder = null
    }
    if (holder === null) {
      return build('ABORTED_NO_HOLDER', [], 0, [])
    }
    result.previousHolderDeploymentId = holder
  }

  // --- Forward assignment, each followed by reconciliation. ----------
  let assignmentFailed = false
  for (const result of domainResults) {
    try {
      const assign = await setAlias(result.domain, stagedDeploymentId, budgetFor(verifyDeadline))
      result.assignCommandOk = assign.ok
      if (!assign.ok && assign.errorCode) result.assignErrorCode = assign.errorCode
    } catch (err) {
      result.assignCommandOk = false
      result.assignErrorCode = sanitizeError(err, 'COMMAND_FAILED')
    }

    // Invariant 3: a failed/timed-out command does NOT prove the server
    // did not apply the change. Always re-read the real holder.
    result.observedStateAfterAssign = await reconcileHolder(
      result.domain,
      stagedDeploymentId,
      result.previousHolderDeploymentId,
      getCurrentHolder,
      budgetFor(verifyDeadline),
    )

    if (result.observedStateAfterAssign !== 'HOLDS_STAGED') {
      assignmentFailed = true
      break
    }
  }

  if (assignmentFailed) {
    const manual = await rollbackAll(
      domainResults,
      stagedDeploymentId,
      setAlias,
      getCurrentHolder,
      now,
      absoluteDeadline,
      operationTimeoutMs,
    )
    return build(
      manual.length > 0
        ? 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED'
        : 'DOMAIN CUTOVER FAILED — ROLLBACK ATTEMPTED',
      [],
      0,
      manual,
    )
  }

  // --- Bounded verification (never consumes the rollback reserve). ---
  const verification: DomainVerifyResult[] = []
  let attempts = 0
  let allVerified = false

  while (now() < verifyDeadline) {
    attempts += 1
    verification.length = 0
    let attemptOk = true
    for (const domain of domains) {
      let v: { ok: boolean; detail?: string | undefined }
      try {
        v = await verifyDomain(
          domain,
          targetCommitSha,
          budgetFor(verifyDeadline),
          stagedDeploymentId,
        )
      } catch (err) {
        v = { ok: false, detail: safeDetail(sanitizeError(err, 'UNKNOWN'), domain) }
      }
      verification.push({ domain, ok: v.ok, detail: v.detail })
      if (!v.ok) attemptOk = false
    }
    if (attemptOk) {
      allVerified = true
      break
    }
    if (now() + verifyIntervalMs < verifyDeadline) {
      await sleep(verifyIntervalMs)
    } else {
      break
    }
  }

  if (!allVerified) {
    const manual = await rollbackAll(
      domainResults,
      stagedDeploymentId,
      setAlias,
      getCurrentHolder,
      now,
      absoluteDeadline,
      operationTimeoutMs,
    )
    return build(
      manual.length > 0
        ? 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED'
        : 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED',
      verification,
      attempts,
      manual,
    )
  }

  return build('CUTOVER_SUCCESS', verification, attempts, [])
}

/**
 * Rolls back every domain observed to actually hold the staged
 * deployment. Each domain is handled independently: a hang, timeout, or
 * failure on one never prevents the others from being attempted.
 * Rollback runs against the absolute deadline (which still has the
 * reserved budget available by construction).
 */
async function rollbackAll(
  domainResults: DomainAliasResult[],
  stagedDeploymentId: string,
  setAlias: SetAliasFn,
  getCurrentHolder: GetCurrentHolderFn,
  now: NowFn,
  absoluteDeadline: number,
  operationTimeoutMs: number,
): Promise<ManualRecoveryEntry[]> {
  const manual: ManualRecoveryEntry[] = []
  const budget = (): number => Math.max(0, Math.min(operationTimeoutMs, absoluteDeadline - now()))

  for (const result of domainResults) {
    // Re-read rather than trusting observedStateAfterAssign, which may
    // be stale or may never have been taken for a domain we broke out
    // before reaching.
    const state = await reconcileHolder(
      result.domain,
      stagedDeploymentId,
      result.previousHolderDeploymentId,
      getCurrentHolder,
      budget(),
    )

    if (state === 'HOLDS_PREVIOUS') {
      // Nothing to undo for this domain.
      continue
    }

    if (state === 'HOLDER_UNKNOWN' || state === 'HOLDS_UNEXPECTED') {
      result.observedStateAfterRollback = state
      manual.push({
        domain: result.domain,
        previousHolderDeploymentId: result.previousHolderDeploymentId,
        observedState: state,
      })
      continue
    }

    // state === 'HOLDS_STAGED' -> must be rolled back.
    if (result.previousHolderDeploymentId === null) {
      result.observedStateAfterRollback = 'HOLDER_UNKNOWN'
      manual.push({
        domain: result.domain,
        previousHolderDeploymentId: null,
        observedState: 'HOLDER_UNKNOWN',
      })
      continue
    }

    result.rolledBack = true
    try {
      const rb = await setAlias(result.domain, result.previousHolderDeploymentId, budget())
      if (!rb.ok && rb.errorCode) result.rollbackErrorCode = rb.errorCode
    } catch (err) {
      result.rollbackErrorCode = sanitizeError(err, 'COMMAND_FAILED')
    }

    // Invariant 5: confirm by observation, not by exit code. A command
    // that timed out but actually took effect counts as succeeded; a
    // command that "succeeded" but did not restore the holder does not.
    const after = await reconcileHolder(
      result.domain,
      stagedDeploymentId,
      result.previousHolderDeploymentId,
      getCurrentHolder,
      budget(),
    )
    result.observedStateAfterRollback = after
    result.rollbackSucceeded = after === 'HOLDS_PREVIOUS'

    if (!result.rollbackSucceeded) {
      manual.push({
        domain: result.domain,
        previousHolderDeploymentId: result.previousHolderDeploymentId,
        observedState: after,
      })
    }
  }

  return manual
}

// --------------------------------------------------------------------
// Pure content checks (fed by already-fetched, size-capped data)
// --------------------------------------------------------------------

export function checkRootContent(html: string): { ok: boolean; detail?: string } {
  if (!/aiscentra/i.test(html)) {
    return { ok: false, detail: safeDetail('CONTENT_MISMATCH', 'root') }
  }
  return { ok: true }
}

export function checkHealthJson(json: unknown): { ok: boolean; detail?: string } {
  const health = json as { status?: unknown; checks?: { database?: unknown } }
  if (health.status !== 'ok') {
    return { ok: false, detail: safeDetail('CONTENT_MISMATCH', 'health.status') }
  }
  if (health.checks?.database !== 'ok') {
    return { ok: false, detail: safeDetail('CONTENT_MISMATCH', 'health.checks.database') }
  }
  return { ok: true }
}

export function checkCommitSha(
  actualSha: unknown,
  expectedSha: string,
): { ok: boolean; detail?: string } {
  if (actualSha !== expectedSha) {
    // Commit SHAs are public, non-sensitive values (unlike tokens/errors
    // sanitized elsewhere in this module) -- showing the actual mismatch
    // here is real debugging information, not a redaction gap. A prior
    // release attempt's diagnostic said only "CONTENT_MISMATCH:
    // githubCommitSha" with no values, which made the real root cause
    // (a domain-metadata propagation delay, not a wrong deployment)
    // needlessly slow to find from the artifact alone.
    const actual = typeof actualSha === 'string' ? actualSha : String(actualSha)
    return {
      ok: false,
      detail: safeDetail(
        'CONTENT_MISMATCH',
        `githubCommitSha got=${actual} expected=${expectedSha}`,
      ),
    }
  }
  return { ok: true }
}

export function extractOpenGraphImageUrl(html: string): string | null {
  const match = html.match(
    /<meta[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i,
  )
  if (match && match[1] !== undefined) return match[1]
  const reversed = html.match(
    /<meta[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:image["'][^>]*>/i,
  )
  return reversed && reversed[1] !== undefined ? reversed[1] : null
}

export function checkOpenGraphTagPresent(html: string): { ok: boolean; detail?: string } {
  if (!extractOpenGraphImageUrl(html)) {
    return { ok: false, detail: safeDetail('CONTENT_MISMATCH', 'og:image missing') }
  }
  return { ok: true }
}

export function checkOpenGraphImageStatus(status: number): { ok: boolean; detail?: string } {
  if (status !== 200) {
    return { ok: false, detail: safeDetail('HTTP_STATUS', `og-image ${status}`) }
  }
  return { ok: true }
}

export function checkOpenGraphImageContentType(contentType: string | null): {
  ok: boolean
  detail?: string
} {
  if (!contentType || !contentType.toLowerCase().startsWith('image/png')) {
    return { ok: false, detail: safeDetail('CONTENT_MISMATCH', 'og-image content-type') }
  }
  return { ok: true }
}

export function checkPngSignature(
  firstEightBytesHex: string,
  expectedHex: string,
): { ok: boolean; detail?: string } {
  if (firstEightBytesHex.toLowerCase() !== expectedHex.toLowerCase()) {
    return { ok: false, detail: safeDetail('CONTENT_MISMATCH', 'png-signature') }
  }
  return { ok: true }
}

// --------------------------------------------------------------------
// Artifact
// --------------------------------------------------------------------

/**
 * Explicit allow-list projection. Any future field added to
 * CutoverDiagnostics must be deliberately routed through here. Every
 * free-form string is length-capped; every error is a structured code.
 */
export function toSafeArtifact(result: CutoverResult): CutoverResult {
  const cap = (s: string | undefined): string | undefined =>
    s === undefined ? undefined : s.length > MAX_DETAIL_LENGTH ? s.slice(0, MAX_DETAIL_LENGTH) : s

  return {
    status: result.status,
    diagnostics: {
      stagedDeploymentId: result.diagnostics.stagedDeploymentId,
      targetCommitSha: result.diagnostics.targetCommitSha,
      domains: result.diagnostics.domains.map((d) => ({
        domain: d.domain,
        previousHolderDeploymentId: d.previousHolderDeploymentId,
        assignCommandOk: d.assignCommandOk,
        observedStateAfterAssign: d.observedStateAfterAssign,
        assignErrorCode: d.assignErrorCode,
        rolledBack: d.rolledBack,
        rollbackSucceeded: d.rollbackSucceeded,
        rollbackErrorCode: d.rollbackErrorCode,
        observedStateAfterRollback: d.observedStateAfterRollback,
      })),
      verification: result.diagnostics.verification.map((v) => ({
        domain: v.domain,
        ok: v.ok,
        detail: cap(v.detail),
      })),
      verifyAttempts: result.diagnostics.verifyAttempts,
      manualRecoveryDomains: result.diagnostics.manualRecoveryDomains.map((m) => ({
        domain: m.domain,
        previousHolderDeploymentId: m.previousHolderDeploymentId,
        observedState: m.observedState,
      })),
    },
  }
}
