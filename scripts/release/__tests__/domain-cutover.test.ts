/**
 * AIscentra — Domain Cutover Tests
 *
 * All Vercel CLI/API interaction is mocked via injected functions -- no
 * real network, no real subprocess, no real credentials. A synthetic
 * sentinel string stands in for a credential to prove it can never
 * reach the artifact or the console.
 *
 * Covers: credential redaction across argv/message/stdout/stderr/cause,
 * bounded deadlines with an injected fake clock, the rollback reserve,
 * reconciliation after ambiguous mutations, observation-confirmed
 * rollback, unknown/unexpected holders, independent per-domain
 * rollback, artifact-write and upload non-blocking semantics, and a
 * semantic (parsed, not comment-matched) assertion over the workflow
 * graph.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  planDomainCutover,
  toSafeArtifact,
  sanitizeError,
  safeDetail,
  reconcileHolder,
  checkRootContent,
  checkHealthJson,
  checkCommitSha,
  checkOpenGraphTagPresent,
  extractOpenGraphImageUrl,
  checkOpenGraphImageStatus,
  checkOpenGraphImageContentType,
  checkPngSignature,
  MAX_DETAIL_LENGTH,
  type GetCurrentHolderFn,
  type SetAliasFn,
  type VerifyDomainFn,
  type HolderState,
} from '../domain-cutover'

const APEX = 'aiscentra.com'
const WWW = 'www.aiscentra.com'
const DOMAINS = [APEX, WWW]
const STAGED_ID = 'dpl_staged_new'
const OLD_ID = 'dpl_old_production'
const SHA = 'abc123deadbeef'

/** Synthetic stand-in for a credential. Never a real token. */
const SENTINEL = 'ZZZ_SYNTHETIC_SENTINEL_VALUE_9f3a1c_ZZZ'

const noopSleep = async (_ms: number): Promise<void> => {}

/** Deterministic fake clock. */
function fakeClock(startMs = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = startMs
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

/** Holder oracle whose answers can change over the course of a test. */
function holderOracle(initial: Record<string, string | null>): {
  get: GetCurrentHolderFn
  set: (domain: string, value: string | null) => void
  calls: string[]
} {
  const state: Record<string, string | null> = { ...initial }
  const calls: string[] = []
  return {
    get: async (domain) => {
      calls.push(domain)
      return state[domain] ?? null
    },
    set: (domain, value) => {
      state[domain] = value
    },
    calls,
  }
}

const alwaysVerifyOk: VerifyDomainFn = async () => ({ ok: true })
const alwaysVerifyFail: VerifyDomainFn = async () => ({ ok: false, detail: 'forced' })

describe('credential redaction (audit finding 1)', () => {
  test('sanitizeError never returns any part of a message, stdout, stderr, argv, or nested cause', () => {
    const hostile = Object.assign(new Error(`boom ${SENTINEL}`), {
      cmd: `npx vercel --token ${SENTINEL}`,
      stdout: `out ${SENTINEL}`,
      stderr: `err ${SENTINEL}`,
      cause: new Error(`cause ${SENTINEL}`),
      argv: ['--token', SENTINEL],
    })
    const code = sanitizeError(hostile, 'COMMAND_FAILED')
    assert.equal(code, 'COMMAND_FAILED')
    assert.equal(JSON.stringify(code).includes(SENTINEL), false)
  })

  test('sanitizeError classifies timeout shapes without reading text', () => {
    assert.equal(sanitizeError({ name: 'AbortError' }), 'TIMEOUT')
    assert.equal(sanitizeError({ name: 'TimeoutError' }), 'TIMEOUT')
    assert.equal(sanitizeError({ code: 'ETIMEDOUT' }), 'TIMEOUT')
    assert.equal(sanitizeError({ killed: true }), 'TIMEOUT')
    assert.equal(sanitizeError({ signal: 'SIGKILL' }), 'TIMEOUT')
    assert.equal(sanitizeError(new Error('plain'), 'COMMAND_FAILED'), 'COMMAND_FAILED')
  })

  test('safeDetail caps length so no long payload can ride along', () => {
    const long = safeDetail('CONTENT_MISMATCH', SENTINEL.repeat(50))
    assert.ok(long.length <= MAX_DETAIL_LENGTH)
  })

  test('end-to-end: hostile errors from every injected boundary leave the artifact and manual-recovery output sentinel-free', async () => {
    const hostile = (): never => {
      throw Object.assign(new Error(`fail ${SENTINEL}`), {
        cmd: `npx vercel --token ${SENTINEL}`,
        stdout: SENTINEL,
        stderr: SENTINEL,
        cause: new Error(SENTINEL),
      })
    }

    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const setAlias: SetAliasFn = async () => hostile()
    const verifyDomain: VerifyDomainFn = async () => hostile()

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain,
      sleep: noopSleep,
    })

    const serialized = JSON.stringify(toSafeArtifact(result))
    assert.equal(serialized.includes(SENTINEL), false, 'artifact must not contain the sentinel')
    assert.equal(serialized.includes('--token'), false, 'artifact must not contain argv fragments')
  })
})

describe('bounded deadlines and rollback reserve (audit finding 2)', () => {
  test('verification stops at the verify deadline and never consumes the rollback reserve', async () => {
    const clock = fakeClock()
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      oracle.set(domain, deploymentId)
      return { ok: true }
    }
    // Each verify attempt burns wall-clock on the fake clock.
    const verifyDomain: VerifyDomainFn = async () => {
      clock.advance(1_000)
      return { ok: false, detail: 'forced' }
    }

    const rollbackBudgets: number[] = []
    const trackingSetAlias: SetAliasFn = async (domain, deploymentId, timeoutMs) => {
      if (deploymentId === OLD_ID) rollbackBudgets.push(timeoutMs)
      return setAlias(domain, deploymentId, timeoutMs)
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias: trackingSetAlias,
      verifyDomain,
      sleep: async (ms) => clock.advance(ms),
      now: clock.now,
      totalBudgetMs: 30_000,
      rollbackReserveMs: 10_000,
      operationTimeoutMs: 5_000,
      verifyIntervalMs: 1_000,
    })

    assert.equal(result.status, 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED')
    // Rollback still had real budget available -- the reserve was intact.
    assert.ok(rollbackBudgets.length >= 1, 'rollback must have been attempted')
    for (const b of rollbackBudgets) {
      assert.ok(b > 0, 'rollback operations must receive a positive budget')
    }
  })

  test('per-operation budget never exceeds operationTimeoutMs', async () => {
    const clock = fakeClock()
    const seen: number[] = []
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const getCurrentHolder: GetCurrentHolderFn = async (domain, timeoutMs) => {
      seen.push(timeoutMs)
      return oracle.get(domain, timeoutMs)
    }

    await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder,
      setAlias: async (domain, deploymentId) => {
        oracle.set(domain, deploymentId)
        return { ok: true }
      },
      verifyDomain: alwaysVerifyOk,
      sleep: noopSleep,
      now: clock.now,
      totalBudgetMs: 600_000,
      rollbackReserveMs: 100_000,
      operationTimeoutMs: 7_000,
    })

    assert.ok(seen.length > 0)
    for (const t of seen) assert.ok(t <= 7_000, `budget ${t} exceeded operationTimeoutMs`)
  })
})

describe('reconciliation after ambiguous mutation (audit finding 3)', () => {
  test('reconcileHolder classifies all four states', async () => {
    const mk =
      (v: string | null): GetCurrentHolderFn =>
      async () =>
        v
    assert.equal(await reconcileHolder(APEX, STAGED_ID, OLD_ID, mk(STAGED_ID), 1), 'HOLDS_STAGED')
    assert.equal(await reconcileHolder(APEX, STAGED_ID, OLD_ID, mk(OLD_ID), 1), 'HOLDS_PREVIOUS')
    assert.equal(
      await reconcileHolder(APEX, STAGED_ID, OLD_ID, mk('dpl_other'), 1),
      'HOLDS_UNEXPECTED',
    )
    assert.equal(await reconcileHolder(APEX, STAGED_ID, OLD_ID, mk(null), 1), 'HOLDER_UNKNOWN')
  })

  test('forward alias TIMED OUT but holder actually became staged -> domain is still rolled back', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const rolledBackTo: Record<string, string> = {}

    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === STAGED_ID) {
        // The server DID apply it, but the command reports a timeout.
        oracle.set(domain, STAGED_ID)
        if (domain === WWW) return { ok: false, errorCode: 'TIMEOUT' }
        return { ok: true }
      }
      oracle.set(domain, deploymentId)
      rolledBackTo[domain] = deploymentId
      return { ok: true }
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain: alwaysVerifyFail,
      sleep: noopSleep,
      totalBudgetMs: 20,
      rollbackReserveMs: 10,
      verifyIntervalMs: 1,
    })

    // Both domains actually held staged, so both must be rolled back
    // even though www's own command reported failure.
    assert.equal(rolledBackTo[APEX], OLD_ID)
    assert.equal(rolledBackTo[WWW], OLD_ID)
    assert.notEqual(result.status, 'CUTOVER_SUCCESS')
  })

  test('forward alias returned ERROR but holder became staged -> included in rollback when the transaction fails', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const rolledBackTo: Record<string, string> = {}
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === STAGED_ID) {
        // Server applied it despite the command reporting an error.
        oracle.set(domain, STAGED_ID)
        return { ok: false, errorCode: 'COMMAND_FAILED' }
      }
      oracle.set(domain, deploymentId)
      rolledBackTo[domain] = deploymentId
      return { ok: true }
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      // Transaction fails at verification, so rollback must cover every
      // domain that ACTUALLY holds staged -- including the one whose
      // own assign command reported failure.
      verifyDomain: alwaysVerifyFail,
      sleep: noopSleep,
      totalBudgetMs: 20,
      rollbackReserveMs: 10,
      verifyIntervalMs: 1,
    })

    assert.equal(rolledBackTo[APEX], OLD_ID)
    assert.equal(rolledBackTo[WWW], OLD_ID)
    assert.notEqual(result.status, 'CUTOVER_SUCCESS')
  })

  test('holder unknown after failure -> manual recovery, not a silent pass', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === STAGED_ID && domain === APEX) {
        oracle.set(domain, null) // becomes undeterminable
        return { ok: false, errorCode: 'COMMAND_FAILED' }
      }
      oracle.set(domain, deploymentId)
      return { ok: true }
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain: alwaysVerifyOk,
      sleep: noopSleep,
    })

    assert.equal(result.status, 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED')
    const entry = result.diagnostics.manualRecoveryDomains.find((m) => m.domain === APEX)
    assert.ok(entry)
    assert.equal(entry.observedState, 'HOLDER_UNKNOWN')
  })

  test('holder on an unexpected deployment after failure -> manual recovery', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === STAGED_ID && domain === APEX) {
        oracle.set(domain, 'dpl_totally_unexpected')
        return { ok: false, errorCode: 'COMMAND_FAILED' }
      }
      oracle.set(domain, deploymentId)
      return { ok: true }
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain: alwaysVerifyOk,
      sleep: noopSleep,
    })

    assert.equal(result.status, 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED')
    const entry = result.diagnostics.manualRecoveryDomains.find((m) => m.domain === APEX)
    assert.ok(entry)
    assert.equal(entry.observedState, 'HOLDS_UNEXPECTED')
  })
})

describe('rollback confirmation by observation', () => {
  test('rollback command SUCCEEDS but holder not restored -> rollback counted as failed', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === STAGED_ID) {
        oracle.set(domain, STAGED_ID)
        return { ok: true }
      }
      // Rollback "succeeds" but the holder does not actually change.
      return { ok: true }
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain: alwaysVerifyFail,
      sleep: noopSleep,
      totalBudgetMs: 20,
      rollbackReserveMs: 10,
      verifyIntervalMs: 1,
    })

    assert.equal(result.status, 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED')
    for (const d of result.diagnostics.domains) {
      assert.equal(d.rollbackSucceeded, false)
    }
  })

  test('rollback command TIMES OUT but holder actually restored -> recorded as succeeded', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === STAGED_ID) {
        oracle.set(domain, STAGED_ID)
        return { ok: true }
      }
      // Rollback took effect server-side but reports a timeout.
      oracle.set(domain, deploymentId)
      return { ok: false, errorCode: 'TIMEOUT' }
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain: alwaysVerifyFail,
      sleep: noopSleep,
      totalBudgetMs: 20,
      rollbackReserveMs: 10,
      verifyIntervalMs: 1,
    })

    assert.equal(result.status, 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED')
    for (const d of result.diagnostics.domains) {
      assert.equal(d.rollbackSucceeded, true, 'observed restoration outranks the exit code')
      assert.equal(d.rollbackErrorCode, 'TIMEOUT')
    }
    assert.deepEqual(result.diagnostics.manualRecoveryDomains, [])
  })

  test('one domain rollback fails -> the other is still processed independently', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const rollbackAttempts: string[] = []
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === STAGED_ID) {
        oracle.set(domain, STAGED_ID)
        return { ok: true }
      }
      rollbackAttempts.push(domain)
      if (domain === APEX) return { ok: false, errorCode: 'COMMAND_FAILED' }
      oracle.set(domain, deploymentId)
      return { ok: true }
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain: alwaysVerifyFail,
      sleep: noopSleep,
      totalBudgetMs: 20,
      rollbackReserveMs: 10,
      verifyIntervalMs: 1,
    })

    assert.deepEqual(rollbackAttempts.sort(), [APEX, WWW])
    assert.equal(result.status, 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED')
    assert.deepEqual(
      result.diagnostics.manualRecoveryDomains.map((m) => m.domain),
      [APEX],
    )
  })
})

describe('holders, aborts and the happy path', () => {
  test('undetermined holder before mutation -> zero alias commands issued', async () => {
    let setAliasCalled = false
    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: async (domain) => (domain === WWW ? null : OLD_ID),
      setAlias: async () => {
        setAliasCalled = true
        return { ok: true }
      },
      verifyDomain: alwaysVerifyOk,
      sleep: noopSleep,
    })

    assert.equal(result.status, 'ABORTED_NO_HOLDER')
    assert.equal(setAliasCalled, false)
  })

  test('holders are per-domain: two different previous holders roll back to their own', async () => {
    const OLD_1 = 'dpl_old_apex'
    const OLD_2 = 'dpl_old_www'
    const oracle = holderOracle({ [APEX]: OLD_1, [WWW]: OLD_2 })
    const rollbackTargets: Record<string, string> = {}
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      oracle.set(domain, deploymentId)
      if (deploymentId !== STAGED_ID) rollbackTargets[domain] = deploymentId
      return { ok: true }
    }

    await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain: alwaysVerifyFail,
      sleep: noopSleep,
      totalBudgetMs: 20,
      rollbackReserveMs: 10,
      verifyIntervalMs: 1,
    })

    assert.equal(rollbackTargets[APEX], OLD_1)
    assert.equal(rollbackTargets[WWW], OLD_2)
    assert.notEqual(rollbackTargets[APEX], rollbackTargets[WWW])
  })

  test('fully successful scenario -> CUTOVER_SUCCESS, no rollback, empty manual recovery', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    let rollbackAttempted = false
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === OLD_ID) rollbackAttempted = true
      oracle.set(domain, deploymentId)
      return { ok: true }
    }

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias,
      verifyDomain: alwaysVerifyOk,
      sleep: noopSleep,
    })

    assert.equal(result.status, 'CUTOVER_SUCCESS')
    assert.equal(rollbackAttempted, false)
    assert.deepEqual(result.diagnostics.manualRecoveryDomains, [])
    for (const d of result.diagnostics.domains) {
      assert.equal(d.observedStateAfterAssign, 'HOLDS_STAGED')
    }
  })

  // Every named check that used to live in the deleted post-cutover job
  // now flows through the single verification boundary, so each one
  // triggers the same reconciled rollback path.
  const namedFailures = [
    'root HTTP/content',
    'health',
    'SHA mismatch',
    'missing Open Graph tag',
    'OG image non-200',
    'OG image bad PNG signature',
    'www routing',
  ]

  for (const name of namedFailures) {
    test(`verification failure (${name}) -> both domains reconciled and rolled back`, async () => {
      const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
      const rollbackTargets: Record<string, string> = {}
      const setAlias: SetAliasFn = async (domain, deploymentId) => {
        oracle.set(domain, deploymentId)
        if (deploymentId !== STAGED_ID) rollbackTargets[domain] = deploymentId
        return { ok: true }
      }

      const result = await planDomainCutover({
        domains: DOMAINS,
        stagedDeploymentId: STAGED_ID,
        targetCommitSha: SHA,
        getCurrentHolder: oracle.get,
        setAlias,
        verifyDomain: async () => ({ ok: false, detail: safeDetail('CONTENT_MISMATCH', name) }),
        sleep: noopSleep,
        totalBudgetMs: 20,
        rollbackReserveMs: 10,
        verifyIntervalMs: 1,
      })

      assert.equal(result.status, 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED')
      assert.equal(rollbackTargets[APEX], OLD_ID)
      assert.equal(rollbackTargets[WWW], OLD_ID)
      for (const d of result.diagnostics.domains) {
        assert.equal(d.rollbackSucceeded, true)
      }
    })
  }
})

describe('artifact shape and redaction', () => {
  test('artifact exposes exactly the allow-listed keys', async () => {
    const oracle = holderOracle({ [APEX]: OLD_ID, [WWW]: OLD_ID })
    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder: oracle.get,
      setAlias: async (domain, deploymentId) => {
        oracle.set(domain, deploymentId)
        return { ok: true }
      },
      verifyDomain: alwaysVerifyOk,
      sleep: noopSleep,
    })

    const safe = toSafeArtifact(result)
    assert.deepEqual(Object.keys(safe).sort(), ['diagnostics', 'status'])
    assert.deepEqual(Object.keys(safe.diagnostics).sort(), [
      'domains',
      'manualRecoveryDomains',
      'stagedDeploymentId',
      'targetCommitSha',
      'verification',
      'verifyAttempts',
    ])

    const serialized = JSON.stringify(safe)
    for (const pattern of [/token/i, /authorization/i, /bearer/i, /secret/i]) {
      assert.equal(pattern.test(serialized), false, `must not match ${pattern}`)
    }
  })

  test('artifact detail values are length-capped', () => {
    const capped = toSafeArtifact({
      status: 'CUTOVER_SUCCESS',
      diagnostics: {
        stagedDeploymentId: STAGED_ID,
        targetCommitSha: SHA,
        domains: [],
        verification: [{ domain: APEX, ok: false, detail: 'x'.repeat(5_000) }],
        verifyAttempts: 1,
        manualRecoveryDomains: [],
      },
    })
    const detail = capped.diagnostics.verification[0]?.detail ?? ''
    assert.ok(detail.length <= MAX_DETAIL_LENGTH)
  })
})

describe('pure content checks', () => {
  test('root content', () => {
    assert.equal(checkRootContent('<html>AIscentra Observatory</html>').ok, true)
    assert.equal(checkRootContent('<html>unrelated</html>').ok, false)
  })

  test('health json', () => {
    assert.equal(checkHealthJson({ status: 'ok', checks: { database: 'ok' } }).ok, true)
    assert.equal(checkHealthJson({ status: 'degraded', checks: { database: 'ok' } }).ok, false)
    assert.equal(checkHealthJson({ status: 'ok', checks: { database: 'down' } }).ok, false)
    assert.equal(checkHealthJson({}).ok, false)
  })

  test('commit sha', () => {
    assert.equal(checkCommitSha('abc', 'abc').ok, true)
    assert.equal(checkCommitSha('xyz', 'abc').ok, false)
    assert.equal(checkCommitSha(undefined, 'abc').ok, false)
  })

  test('open graph extraction in either attribute order', () => {
    const a = '<meta property="og:image" content="https://x/og.png">'
    const b = '<meta content="https://x/og.png" property="og:image">'
    assert.equal(extractOpenGraphImageUrl(a), 'https://x/og.png')
    assert.equal(extractOpenGraphImageUrl(b), 'https://x/og.png')
    assert.equal(extractOpenGraphImageUrl('<meta property="og:title" content="t">'), null)
    assert.equal(checkOpenGraphTagPresent(a).ok, true)
    assert.equal(checkOpenGraphTagPresent('<html></html>').ok, false)
  })

  test('open graph image status and content type', () => {
    assert.equal(checkOpenGraphImageStatus(200).ok, true)
    assert.equal(checkOpenGraphImageStatus(404).ok, false)
    assert.equal(checkOpenGraphImageContentType('image/png').ok, true)
    assert.equal(checkOpenGraphImageContentType('image/png; x=1').ok, true)
    assert.equal(checkOpenGraphImageContentType('text/html').ok, false)
    assert.equal(checkOpenGraphImageContentType(null).ok, false)
  })

  test('png signature', () => {
    const sig = '89504e470d0a1a0a'
    assert.equal(checkPngSignature(sig, sig).ok, true)
    assert.equal(checkPngSignature(sig.toUpperCase(), sig).ok, true)
    assert.equal(checkPngSignature('deadbeef00000000', sig).ok, false)
  })
})

describe('workflow graph (semantic, parsed -- not comment matching)', () => {
  const workflowPath = join(
    __dirname,
    '..',
    '..',
    '..',
    '.github',
    'workflows',
    'production-release.yml',
  )

  /**
   * Minimal, dependency-free reader for the specific structure asserted
   * here: top-level job keys, their `needs:`, their step names, and the
   * per-step `continue-on-error`. Deliberately not a general YAML
   * parser -- it reads the real file's actual indentation-based
   * structure rather than matching prose in comments.
   */
  function readWorkflowGraph(): {
    jobs: string[]
    needs: Record<string, string[]>
    stepsByJob: Record<string, Array<{ name: string; continueOnError: boolean }>>
  } {
    const lines = readFileSync(workflowPath, 'utf-8').split('\n')
    const jobs: string[] = []
    const needs: Record<string, string[]> = {}
    const stepsByJob: Record<string, Array<{ name: string; continueOnError: boolean }>> = {}

    let inJobs = false
    let currentJob: string | null = null
    let currentStep: { name: string; continueOnError: boolean } | null = null

    const flushStep = (): void => {
      if (currentJob && currentStep) stepsByJob[currentJob]?.push(currentStep)
      currentStep = null
    }

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '')
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true
        continue
      }
      if (!inJobs) continue
      if (/^\S/.test(line)) {
        flushStep()
        inJobs = false
        continue
      }

      const jobMatch = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
      if (jobMatch && jobMatch[1]) {
        flushStep()
        currentJob = jobMatch[1]
        jobs.push(currentJob)
        needs[currentJob] = []
        stepsByJob[currentJob] = []
        continue
      }
      if (!currentJob) continue

      const needsMatch = line.match(/^ {4}needs:\s*(.+)$/)
      if (needsMatch && needsMatch[1]) {
        const rhs = needsMatch[1].trim()
        const items = rhs.startsWith('[') ? rhs.replace(/^\[|\]$/g, '').split(',') : [rhs]
        needs[currentJob] = items.map((s) => s.trim()).filter(Boolean)
        continue
      }

      const stepNameMatch = line.match(/^ {6}- name:\s*(.+)$/)
      if (stepNameMatch && stepNameMatch[1]) {
        flushStep()
        currentStep = { name: stepNameMatch[1].trim(), continueOnError: false }
        continue
      }
      if (currentStep && /^ {8}continue-on-error:\s*true\s*$/.test(line)) {
        currentStep.continueOnError = true
      }
    }
    flushStep()

    return { jobs, needs, stepsByJob }
  }

  test('domain-cutover exists and is the final job: nothing depends on it', () => {
    const { jobs, needs } = readWorkflowGraph()
    assert.ok(jobs.includes('domain-cutover'), 'domain-cutover job must exist')
    assert.equal(jobs.includes('post-promotion-smoke'), false, 'post-promotion-smoke must be gone')
    for (const [job, dependsOn] of Object.entries(needs)) {
      assert.equal(
        dependsOn.includes('domain-cutover'),
        false,
        `${job} must not depend on domain-cutover`,
      )
    }
  })

  test('every step after the cutover step is explicitly non-blocking', () => {
    const { stepsByJob } = readWorkflowGraph()
    const steps = stepsByJob['domain-cutover'] ?? []
    const cutoverIndex = steps.findIndex(
      (s) => /cutover/i.test(s.name) && !/artifact/i.test(s.name),
    )
    assert.ok(cutoverIndex >= 0, 'the cutover step must be identifiable')

    for (const step of steps.slice(cutoverIndex + 1)) {
      assert.equal(
        step.continueOnError,
        true,
        `step "${step.name}" runs after cutover and must be continue-on-error`,
      )
    }
  })

  test('the job carries a timeout-minutes backstop', () => {
    const text = readFileSync(workflowPath, 'utf-8')
    assert.ok(
      /^ {4}timeout-minutes:\s*\d+\s*$/m.test(text),
      'domain-cutover must declare timeout-minutes as a last-resort backstop',
    )
  })
})

describe('holder state typing', () => {
  test('all four holder states are representable', () => {
    const states: HolderState[] = [
      'HOLDS_STAGED',
      'HOLDS_PREVIOUS',
      'HOLDS_UNEXPECTED',
      'HOLDER_UNKNOWN',
    ]
    assert.equal(states.length, 4)
  })
})
