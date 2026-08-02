/**
 * AIscentra — Domain Cutover Helper Tests (Phase 1C-B2 correction)
 *
 * All Vercel CLI/API interaction is mocked via injected functions --
 * no real network or subprocess calls. Covers exactly the six required
 * scenarios plus the secret-redaction assertion.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  planDomainCutover,
  toSafeArtifact,
  type GetCurrentHolderFn,
  type SetAliasFn,
  type VerifyDomainFn,
} from '../domain-cutover'

const DOMAINS = ['aiscentra.com', 'www.aiscentra.com']
const STAGED_ID = 'dpl_staged_new'
const OLD_ID = 'dpl_old_production'
const SHA = 'abc123deadbeef'

const noopSleep = async (_ms: number): Promise<void> => {}

describe('planDomainCutover', () => {
  test('scenario 1: both domains have one clear previous holder -> both cut over and verified', async () => {
    const getCurrentHolder: GetCurrentHolderFn = async () => OLD_ID
    const setCalls: Array<[string, string]> = []
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      setCalls.push([domain, deploymentId])
      return { ok: true }
    }
    const verifyDomain: VerifyDomainFn = async () => ({ ok: true })

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder,
      setAlias,
      verifyDomain,
      sleep: noopSleep,
    })

    assert.equal(result.status, 'CUTOVER_SUCCESS')
    assert.equal(setCalls.length, 2)
    for (const d of result.diagnostics.domains) {
      assert.equal(d.previousHolderDeploymentId, OLD_ID)
      assert.equal(d.assignSucceeded, true)
      assert.equal(d.rolledBack, false)
    }
    assert.equal(result.diagnostics.verification.length, DOMAINS.length)
    assert.ok(result.diagnostics.verification.every((v) => v.ok))
  })

  test('scenario 2: at least one previous holder cannot be determined -> zero alias commands issued', async () => {
    let holderCalls = 0
    const getCurrentHolder: GetCurrentHolderFn = async (domain) => {
      holderCalls += 1
      return domain === 'www.aiscentra.com' ? null : OLD_ID
    }
    let setAliasCalled = false
    const setAlias: SetAliasFn = async () => {
      setAliasCalled = true
      return { ok: true }
    }
    const verifyDomain: VerifyDomainFn = async () => ({ ok: true })

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder,
      setAlias,
      verifyDomain,
      sleep: noopSleep,
    })

    assert.equal(result.status, 'ABORTED_NO_HOLDER')
    assert.equal(
      setAliasCalled,
      false,
      'setAlias must never be called when a holder is undetermined',
    )
    assert.ok(holderCalls >= 1)
  })

  test('scenario 3: first alias assigned, second fails -> first is rolled back to its previous holder', async () => {
    const getCurrentHolder: GetCurrentHolderFn = async () => OLD_ID
    const setCalls: Array<{ domain: string; deploymentId: string }> = []
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      setCalls.push({ domain, deploymentId })
      if (domain === 'www.aiscentra.com') {
        return { ok: false, error: 'simulated assign failure' }
      }
      return { ok: true }
    }
    const verifyDomain: VerifyDomainFn = async () => ({ ok: true })

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder,
      setAlias,
      verifyDomain,
      sleep: noopSleep,
    })

    assert.equal(result.status, 'DOMAIN_CUTOVER_FAILED_ROLLBACK_ATTEMPTED')

    const first = result.diagnostics.domains.find((d) => d.domain === 'aiscentra.com')
    const second = result.diagnostics.domains.find((d) => d.domain === 'www.aiscentra.com')
    assert.ok(first, 'expected a result entry for aiscentra.com')
    assert.ok(second, 'expected a result entry for www.aiscentra.com')

    assert.equal(first.assignSucceeded, true)
    assert.equal(first.rolledBack, true)
    assert.equal(first.rollbackSucceeded, true)

    assert.equal(second.assignSucceeded, false)
    assert.equal(
      second.rolledBack,
      false,
      'a domain whose own assign failed is not itself "rolled back"',
    )

    // Rollback call for the first domain must target its ORIGINAL holder,
    // not the staged deployment.
    const rollbackCall = setCalls.find(
      (c) => c.domain === 'aiscentra.com' && c.deploymentId === OLD_ID,
    )
    assert.ok(rollbackCall, 'expected a rollback setAlias call restoring aiscentra.com to OLD_ID')
  })

  test('scenario 4: both domains assigned but final verification never confirms -> both rolled back', async () => {
    const getCurrentHolder: GetCurrentHolderFn = async () => OLD_ID
    const setCalls: Array<{ domain: string; deploymentId: string }> = []
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      setCalls.push({ domain, deploymentId })
      return { ok: true }
    }
    const verifyDomain: VerifyDomainFn = async () => ({ ok: false, detail: 'sha mismatch' })

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder,
      setAlias,
      verifyDomain,
      sleep: noopSleep,
      verifyTimeoutMs: 20,
      verifyIntervalMs: 5,
    })

    assert.equal(result.status, 'PUBLIC_RELEASE_NOT_VERIFIED_ROLLBACK_ATTEMPTED')
    for (const d of result.diagnostics.domains) {
      assert.equal(d.assignSucceeded, true)
      assert.equal(d.rolledBack, true)
      assert.equal(d.rollbackSucceeded, true)
    }
    // Every domain must have been reassigned back to OLD_ID during rollback.
    const rollbackCalls = setCalls.filter((c) => c.deploymentId === OLD_ID)
    assert.equal(rollbackCalls.length, DOMAINS.length)
  })

  test('scenario 5: diagnostic artifact never contains secrets, tokens, or raw payloads', async () => {
    const getCurrentHolder: GetCurrentHolderFn = async () => OLD_ID
    const setAlias: SetAliasFn = async () => ({ ok: true })
    const verifyDomain: VerifyDomainFn = async () => ({ ok: true, detail: 'HTTP 200, sha match' })

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder,
      setAlias,
      verifyDomain,
      sleep: noopSleep,
    })

    const safe = toSafeArtifact(result)
    const serialized = JSON.stringify(safe)

    // Structural assertion: only the expected top-level keys exist.
    assert.deepEqual(Object.keys(safe).sort(), ['diagnostics', 'status'])
    assert.deepEqual(Object.keys(safe.diagnostics).sort(), [
      'domains',
      'stagedDeploymentId',
      'targetCommitSha',
      'verification',
      'verifyAttempts',
    ])

    // Negative assertion: no field name or value resembling a secret,
    // token, or auth header ever appears in the serialized artifact.
    const forbiddenPatterns = [/token/i, /authorization/i, /bearer/i, /secret/i, /vercel_token/i]
    for (const pattern of forbiddenPatterns) {
      assert.equal(
        pattern.test(serialized),
        false,
        `serialized artifact must not match forbidden pattern ${pattern}`,
      )
    }
  })

  test('scenario 6: cutover helper is only ever invoked with a target commit sha and staged id (integration contract)', async () => {
    // This test asserts the *contract* the workflow must uphold: the
    // helper itself has no way to run before staged-smoke, since it
    // requires the caller to supply stagedDeploymentId and
    // targetCommitSha explicitly. This test documents and locks that
    // contract at the type/shape level -- the workflow wiring itself
    // (calling this helper only after the staged-smoke job succeeds) is
    // enforced by GitHub Actions `needs:` dependencies, verified
    // separately in the workflow YAML review, not by this unit test.
    const getCurrentHolder: GetCurrentHolderFn = async () => OLD_ID
    const setAlias: SetAliasFn = async () => ({ ok: true })
    const verifyDomain: VerifyDomainFn = async () => ({ ok: true })

    const result = await planDomainCutover({
      domains: DOMAINS,
      stagedDeploymentId: STAGED_ID,
      targetCommitSha: SHA,
      getCurrentHolder,
      setAlias,
      verifyDomain,
      sleep: noopSleep,
    })

    assert.equal(result.diagnostics.stagedDeploymentId, STAGED_ID)
    assert.equal(result.diagnostics.targetCommitSha, SHA)
  })
})
