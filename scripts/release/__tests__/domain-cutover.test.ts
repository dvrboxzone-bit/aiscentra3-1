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
  checkActiveSignalCountAttribute,
  checkCommitSha,
  checkOpenGraphTagPresent,
  extractOpenGraphImageUrl,
  checkOpenGraphImageStatus,
  checkOpenGraphImageContentType,
  checkPngSignature,
  extractRealSignalPath,
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

  test('active signal count attribute -- real incident-driven check, immune to React SSR hydration comments (health alone would have missed the empty-feed case; a text-substring check itself produced a real production false negative)', () => {
    // REAL PRODUCTION INCIDENT this specific test reproduces exactly:
    // React's SSR inserts <!-- --> comments between adjacent JSX
    // expression children -- the raw markup for
    // `{signals.length} active signal{s} detected` is genuinely
    // `128<!-- --> active signal<!-- --><!-- --> detected`, not a
    // continuous string. A text-substring check against this exact
    // fragment correctly FAILED in production even though the system
    // was healthy (128 real ACTIVE signals, correctly gated open).
    // data-active-signal-count is immune to this because an HTML
    // attribute value is never split by adjacent-children hydration
    // comments -- it is always one continuous string.
    const realSsrFragmentWithComments =
      '<div data-active-signal-count="128"><p class="mt-2 text-sm">128<!-- --> active signal<!-- --><!-- --> detected</p></div>'
    const result = checkActiveSignalCountAttribute(realSsrFragmentWithComments)
    assert.equal(
      result.ok,
      true,
      'the attribute-based check must pass on the EXACT real SSR fragment that broke the old text check',
    )
    assert.equal(result.count, 128)
  })

  test('a genuine positive count passes, count value is returned', () => {
    const result = checkActiveSignalCountAttribute('<div data-active-signal-count="42">...</div>')
    assert.equal(result.ok, true)
    assert.equal(result.count, 42)
  })

  test('a count of exactly 1 (singular, no special-casing needed for an attribute value) passes', () => {
    assert.equal(
      checkActiveSignalCountAttribute('<div data-active-signal-count="1">...</div>').ok,
      true,
    )
  })

  test('count=0 fails closed -- an empty feed must never be treated as acceptable', () => {
    const result = checkActiveSignalCountAttribute('<div data-active-signal-count="0">...</div>')
    assert.equal(result.ok, false, 'zero is not a genuine non-empty feed')
  })

  test('a negative count fails closed (malformed/impossible value)', () => {
    assert.equal(
      checkActiveSignalCountAttribute('<div data-active-signal-count="-5">...</div>').ok,
      false,
    )
  })

  test('a non-integer count fails closed', () => {
    assert.equal(
      checkActiveSignalCountAttribute('<div data-active-signal-count="12.5">...</div>').ok,
      false,
    )
  })

  test('the attribute entirely MISSING fails closed -- never assumed to be fine by default', () => {
    assert.equal(
      checkActiveSignalCountAttribute(
        '<html><p>Something else entirely, no attribute at all</p></html>',
      ).ok,
      false,
    )
  })

  test('the attribute appearing TWICE (duplicated) fails closed -- ambiguous, which one is real?', () => {
    const html =
      '<div data-active-signal-count="42">...</div><div data-active-signal-count="7">stale cached fragment</div>'
    const result = checkActiveSignalCountAttribute(html)
    assert.equal(
      result.ok,
      false,
      'a duplicated attribute must never be silently resolved by picking one value',
    )
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

  describe('extractRealSignalPath -- the shared helper behind staged smoke, TOCTOU, and post-cutover verifyDomain', () => {
    test("a real signal-card href (matching signal-card.tsx's own `/signals/${signal.id}` output) is extracted as a clean same-origin path", () => {
      // Real markup shape this project's own /signals page actually
      // renders (signal-card.tsx: `href={`/signals/${signal.id}`}`).
      const realHtml =
        '<a class="block" href="/signals/21a20bd4-d3f6-45f4-b9c3-f23f48103888"><h3>GitHub Availability</h3></a>'
      assert.equal(extractRealSignalPath(realHtml), '/signals/21a20bd4-d3f6-45f4-b9c3-f23f48103888')
    })

    test("the listing page's OWN links (bare /signals and /signals?category=...) are excluded -- only a genuine detail-page slug counts", () => {
      const html =
        '<a href="/signals?category=RESEARCH">Research</a><a href="/signals">All</a>' +
        '<a href="/signals/real-slug-1">Real Signal</a>'
      assert.equal(
        extractRealSignalPath(html),
        '/signals/real-slug-1',
        'must skip the category-filter and bare-listing links entirely and find the real detail link',
      )
    })

    test('an absolute URL (even a genuinely same-origin one) is rejected outright, not partially parsed -- a real Next.js-rendered internal link is always relative, and accepting an absolute form at all previously created a real cross-origin extraction bug (see the next test)', () => {
      const html = '<a href="https://aiscentra.com/signals/abc-123-def">Title</a>'
      assert.equal(
        extractRealSignalPath(html),
        null,
        'an absolute URL must never be accepted, even when its own host happens to be the real site -- only a genuine relative href is trusted',
      )
    })

    test('a query string or fragment appended to a real signal link is stripped -- exact required output shape "/signals/<slug>"', () => {
      assert.equal(
        extractRealSignalPath('<a href="/signals/xyz-1?utm_source=x">t</a>'),
        '/signals/xyz-1',
      )
      assert.equal(
        extractRealSignalPath('<a href="/signals/xyz-2#section">t</a>'),
        '/signals/xyz-2',
      )
    })

    test('a cross-origin link is never returned, even if it superficially resembles a signal path', () => {
      assert.equal(
        extractRealSignalPath('<a href="https://evil.example.com/signals/fake-1">t</a>'),
        null,
        'a real signal link must be same-origin -- an external domain is never a valid extraction result',
      )
    })

    test('a protocol-relative (//host/...) link is never returned', () => {
      assert.equal(extractRealSignalPath('<a href="//evil.example.com/signals/fake-2">t</a>'), null)
    })

    test('fail-closed: no signal link present at all returns null, never a fabricated/guessed path', () => {
      assert.equal(
        extractRealSignalPath('<html><body>No signal links here at all</body></html>'),
        null,
      )
    })

    test("fail-closed: only the listing page's own links present (no real detail link) returns null", () => {
      assert.equal(
        extractRealSignalPath(
          '<a href="/signals">All</a><a href="/signals?category=MODELS">Models</a>',
        ),
        null,
      )
    })

    test('the FIRST genuine signal link is returned when multiple exist, matching real /signals page markup with many signal cards', () => {
      const html =
        '<a href="/signals?category=RESEARCH">Research</a>' +
        '<a href="/signals/first-real-signal">First</a>' +
        '<a href="/signals/second-real-signal">Second</a>'
      assert.equal(extractRealSignalPath(html), '/signals/first-real-signal')
    })
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

  test('the single protected production-release job is final: nothing depends on it', () => {
    const { jobs, needs } = readWorkflowGraph()
    assert.ok(jobs.includes('production-release'), 'production-release job must exist')
    assert.equal(jobs.includes('post-promotion-smoke'), false, 'post-promotion-smoke must be gone')
    for (const [job, dependsOn] of Object.entries(needs)) {
      assert.equal(
        dependsOn.includes('production-release'),
        false,
        `${job} must not depend on production-release`,
      )
    }
  })

  test('every step after the cutover step is explicitly non-blocking', () => {
    const { stepsByJob } = readWorkflowGraph()
    const steps = stepsByJob['production-release'] ?? []
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

  test('the cutover step carries a timeout-minutes backstop', () => {
    const text = readFileSync(workflowPath, 'utf-8')
    assert.ok(
      /- name: Run explicit domain cutover\r?\n {8}id: cutover\r?\n {8}timeout-minutes:\s*\d+/m.test(
        text,
      ),
      'the domain cutover step must declare timeout-minutes as a last-resort backstop',
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

describe('per-signal Open Graph image protection (staged smoke, TOCTOU, and post-cutover) -- real production incident: /signals/<slug>/opengraph-image returned HTTP 200, image/png, and a genuinely empty (0-byte) body', () => {
  const workflowPath2 = join(
    __dirname,
    '..',
    '..',
    '..',
    '.github',
    'workflows',
    'production-release.yml',
  )
  const runCutoverPath = join(__dirname, '..', 'run-domain-cutover.ts')

  test('staged-smoke declares a real per-signal Open Graph smoke step, using the SAME shared extractRealSignalPath implementation (via its CLI wrapper) as the site-wide checks', () => {
    const text = readFileSync(workflowPath2, 'utf-8')
    assert.match(
      text,
      /Per-signal Open Graph image smoke/,
      'staged-smoke must declare a real step name for the per-signal OG check',
    )
    assert.match(
      text,
      /scripts\/release\/extract-signal-path\.ts/,
      'staged-smoke must invoke the ONE shared extractRealSignalPath CLI wrapper, not a hand-copied extraction',
    )
  })

  test('the pre-promotion TOCTOU recheck job ALSO declares a real per-signal Open Graph re-check step, using the same shared implementation -- not a second, independently hand-copied one', () => {
    const text = readFileSync(workflowPath2, 'utf-8')
    const toctouSectionStart = text.indexOf('# pre-promotion-recheck')
    assert.ok(toctouSectionStart > 0, 'the pre-promotion-recheck phase must exist')
    const toctouSection = text.slice(toctouSectionStart)
    assert.match(
      toctouSection,
      /Re-check[\s\S]{0,4000}extract-signal-path\.ts/,
      'the TOCTOU job must re-invoke the SAME shared extract-signal-path.ts CLI wrapper for its own per-signal OG re-check, immediately before promotion',
    )
  })

  test('the TOCTOU recheck genuinely fails closed on an empty per-signal OG body -- the exact real production incident, checked explicitly by size, not merely inferred from a truncated signature read', () => {
    const text = readFileSync(workflowPath2, 'utf-8')
    assert.match(
      text,
      /RECHECK_SIGNAL_OG_SIZE.*-ne 0/,
      'the TOCTOU per-signal OG re-check must explicitly reject a genuinely empty (0-byte) body, matching the real incident exactly',
    )
  })

  test('the post-cutover verifyDomain (run-domain-cutover.ts) genuinely imports and calls the SAME shared extractRealSignalPath implementation -- not a hand-copied regex reimplemented for the live-domain check', () => {
    const text = readFileSync(runCutoverPath, 'utf-8')
    const importBlockMatch = /import\s*\{([\s\S]{0,1000}?)\}\s*from\s*'\.\/domain-cutover'/.exec(
      text,
    )
    assert.ok(
      importBlockMatch,
      "run-domain-cutover.ts must have a real import from './domain-cutover'",
    )
    assert.match(
      importBlockMatch?.[1] ?? '',
      /extractRealSignalPath/,
      'run-domain-cutover.ts must import extractRealSignalPath from the ONE shared implementation in domain-cutover.ts',
    )
    assert.match(
      text,
      /const signalPath = extractRealSignalPath\(signalsText\)/,
      'verifyDomain must genuinely call extractRealSignalPath against the real, already-fetched live /signals HTML (signalsText), not a separately-fetched or fabricated value',
    )
  })

  test('the post-cutover verifyDomain fails closed (returns ok:false) when no real signal path is found -- never silently skips the check or substitutes a guessed path', () => {
    const text = readFileSync(runCutoverPath, 'utf-8')
    assert.match(
      text,
      /if \(!signalPath\) return fail\('CONTENT_MISMATCH', 'signal-path-extraction'\)/,
      'a missing signal path must be a hard, explicit verifyDomain failure -- not a silently-skipped check',
    )
  })

  test('the post-cutover verifyDomain explicitly rejects a genuinely empty (0-byte) per-signal OG body -- the exact real production incident this whole protection exists for', () => {
    const text = readFileSync(runCutoverPath, 'utf-8')
    assert.match(
      text,
      /signalOgFullBytes\.byteLength === 0[\s\S]{0,100}return fail\('CONTENT_MISMATCH', 'signal-og-image-empty-body'\)/,
      'verifyDomain must explicitly check for and reject a genuinely empty body -- the literal real production defect (HTTP 200, image/png, 0 bytes)',
    )
  })

  test('a verifyDomain failure genuinely participates in the SAME rollback mechanism as every other check -- proven by planDomainCutover\'s own already-tested "any verify failure triggers rollback" behavior, since the new per-signal check is INSIDE the same try block returning the same { ok: false } shape verifyDomain always returns', () => {
    const text = readFileSync(runCutoverPath, 'utf-8')
    // The new per-signal OG checks must live INSIDE the same verifyDomain
    // function body as the pre-existing root/health/SHA/site-wide-OG
    // checks (which are already proven, via the "rollback confirmation
    // by observation" and "holders, aborts and the happy path" describe
    // blocks above, to trigger rollback through planDomainCutover's real
    // decision logic whenever verifyDomain returns ok:false) -- not a
    // separate, unwired function whose failure would never reach that
    // mechanism at all.
    const verifyDomainStart = text.indexOf('const verifyDomain: VerifyDomainFn')
    assert.ok(verifyDomainStart > 0, 'verifyDomain must be defined as a real VerifyDomainFn')
    const signalPathCallIndex = text.indexOf('extractRealSignalPath(signalsText)')
    assert.ok(signalPathCallIndex > verifyDomainStart, 'the call must be inside verifyDomain')
    // The real outer catch that closes verifyDomain's own try block --
    // searched AFTER the signal-path call itself (not the first catch
    // after verifyDomainStart, since an earlier, nested try/catch for a
    // sub-operation inside the same function would otherwise be found
    // instead, giving a false negative).
    const outerCatchIndex = text.indexOf('} catch (err) {', signalPathCallIndex)
    assert.ok(
      outerCatchIndex > signalPathCallIndex,
      'verifyDomain must have a real outer catch after the new check',
    )
    const finalSuccessReturnIndex = text.indexOf(
      "return { ok: true, detail: 'verified' }",
      signalPathCallIndex,
    )
    assert.ok(
      finalSuccessReturnIndex > signalPathCallIndex && finalSuccessReturnIndex < outerCatchIndex,
      "the final success return must come AFTER the new per-signal check and BEFORE the outer catch -- proving the check genuinely gates the same try block's own success path, not a disconnected side check",
    )
  })

  test('regression: /tmp/signals.html is genuinely still readable when the per-signal Open Graph step reads it -- staged-smoke must NEVER remove it on the success path before the per-signal step consumes it (real merge-blocking incident: a prior version cleaned up the file immediately after the signal-feed smoke step\'s own success echo, guaranteeing "fail could not read HTML file" in the very next step on every real run)', () => {
    const text = readFileSync(workflowPath2, 'utf-8')

    // Locate the staged-smoke job's own "Signal feed smoke" success
    // echo (the point right after which the OLD, buggy version removed
    // the file) and the "Per-signal Open Graph image smoke" step's own
    // read of that same file via the shared extract-signal-path.ts CLI
    // wrapper.
    const signalFeedEchoIndex = text.indexOf(
      'Signal feed smoke: HTTP $STATUS, feed genuinely non-empty',
    )
    assert.ok(signalFeedEchoIndex > 0, "the Signal feed smoke step's own success echo must exist")

    const perSignalReadIndex = text.indexOf(
      'extract-signal-path.ts /tmp/signals.html',
      signalFeedEchoIndex,
    )
    assert.ok(
      perSignalReadIndex > signalFeedEchoIndex,
      "the per-signal step must read /tmp/signals.html via the shared extract-signal-path.ts CLI wrapper, after the signal-feed step's own success echo",
    )

    // The real regression: a `rm -f` targeting /tmp/signals.html
    // positioned ANYWHERE between those two points would delete the
    // file before the per-signal step gets to read it -- this must be
    // impossible, not merely improbable. Deliberately does not attempt
    // to distinguish "textually before but inside an unrelated
    // early-exit failure branch" from a genuine success-path removal --
    // ANY occurrence in this exact window is disqualifying, since a
    // correct fix removes the premature cleanup entirely rather than
    // making it conditional.
    const between = text.slice(signalFeedEchoIndex, perSignalReadIndex)
    assert.doesNotMatch(
      between,
      /rm -f[^\n]*\/tmp\/signals\.html/,
      '/tmp/signals.html must not be removed anywhere between the signal-feed step\'s own success echo and the per-signal step\'s own read of that file -- this is the exact real regression (staged-smoke would deterministically fail with "fail could not read HTML file" on every real production release)',
    )

    // Positive half of the same invariant: the file IS genuinely
    // cleaned up eventually, just not prematurely -- after the
    // per-signal read, not before it.
    const afterPerSignalRead = text.slice(perSignalReadIndex)
    assert.match(
      afterPerSignalRead,
      /rm -f[^\n]*\/tmp\/signals\.html/,
      '/tmp/signals.html must still genuinely be cleaned up at some point after the per-signal step reads it -- not simply left behind forever',
    )
  })
})
