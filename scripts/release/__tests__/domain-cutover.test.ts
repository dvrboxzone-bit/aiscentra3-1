/**
 * AIscentra — Domain Cutover Helper Tests (Phase 1C-B2/B3 correction)
 *
 * All Vercel CLI/API interaction is mocked via injected functions --
 * no real network or subprocess calls. Covers: the original 6 required
 * scenarios, per-domain (not shared) holder storage, partial rollback
 * failure with manual-recovery reporting, a fully successful scenario,
 * every named post-cutover check now folded into the single
 * verification boundary (root/health/SHA/Open Graph tag/Open Graph
 * image status/PNG signature/www routing), a structural check that the
 * workflow graph contains no blocking job downstream of a successful
 * cutover, and unit tests for every pure content-check function.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  planDomainCutover,
  toSafeArtifact,
  checkRootContent,
  checkHealthJson,
  checkCommitSha,
  checkOpenGraphTagPresent,
  extractOpenGraphImageUrl,
  checkOpenGraphImageStatus,
  checkOpenGraphImageContentType,
  checkPngSignature,
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

    assert.equal(result.status, 'DOMAIN CUTOVER FAILED — ROLLBACK ATTEMPTED')

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

    assert.equal(result.status, 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED')
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
      'manualRecoveryDomains',
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

  test('holders are stored per-domain, not assumed shared: two domains with two DIFFERENT previous holders', async () => {
    const OLD_ID_1 = 'dpl_old_holder_for_apex'
    const OLD_ID_2 = 'dpl_old_holder_for_www'
    const getCurrentHolder: GetCurrentHolderFn = async (domain) =>
      domain === 'aiscentra.com' ? OLD_ID_1 : OLD_ID_2
    const rollbackTargets: Record<string, string> = {}
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId !== STAGED_ID) rollbackTargets[domain] = deploymentId
      return { ok: true }
    }
    const verifyDomain: VerifyDomainFn = async () => ({
      ok: false,
      detail: 'forced failure to observe rollback targets',
    })

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

    assert.equal(result.status, 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED')
    assert.equal(rollbackTargets['aiscentra.com'], OLD_ID_1)
    assert.equal(rollbackTargets['www.aiscentra.com'], OLD_ID_2)
    assert.notEqual(rollbackTargets['aiscentra.com'], rollbackTargets['www.aiscentra.com'])
  })

  test('rollback partial failure: one domain rollback fails, the other is still attempted, overall exit is non-zero, manual recovery is listed', async () => {
    const getCurrentHolder: GetCurrentHolderFn = async () => OLD_ID
    const rollbackCalls: string[] = []
    const setAlias: SetAliasFn = async (domain, deploymentId) => {
      if (deploymentId === STAGED_ID) {
        // Initial forward assignment: succeed for both domains so we
        // reach the verification-failure rollback path deterministically.
        return { ok: true }
      }
      // This is a rollback call (deploymentId === OLD_ID for both, since
      // both domains share the same previous holder in this fixture).
      rollbackCalls.push(domain)
      if (domain === 'aiscentra.com') {
        return { ok: false, error: 'simulated rollback failure' }
      }
      return { ok: true }
    }
    const verifyDomain: VerifyDomainFn = async () => ({
      ok: false,
      detail: 'forced verification failure',
    })

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

    assert.equal(result.status, 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED')
    // Both domains' rollback must still have been ATTEMPTED, even though
    // the first one failed -- the loop must not stop early.
    assert.deepEqual(rollbackCalls.sort(), ['aiscentra.com', 'www.aiscentra.com'])

    const failedDomain = result.diagnostics.domains.find((d) => d.domain === 'aiscentra.com')
    assert.ok(failedDomain)
    assert.equal(failedDomain.rollbackSucceeded, false)

    assert.deepEqual(result.diagnostics.manualRecoveryDomains, [
      { domain: 'aiscentra.com', previousHolderDeploymentId: OLD_ID },
    ])
  })

  test('fully successful scenario: rollback is never called, status is CUTOVER_SUCCESS, manualRecoveryDomains is empty', async () => {
    const getCurrentHolder: GetCurrentHolderFn = async () => OLD_ID
    let rollbackAttempted = false
    const setAlias: SetAliasFn = async (_domain, deploymentId) => {
      if (deploymentId === OLD_ID) rollbackAttempted = true
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
    assert.equal(rollbackAttempted, false)
    assert.deepEqual(result.diagnostics.manualRecoveryDomains, [])
  })

  // Each of these represents one of the checks formerly living in the
  // now-removed post-promotion-smoke job. From planDomainCutover's own
  // perspective every one of them is simply "verifyDomain returned
  // ok: false for some reason" -- which is precisely the point: there is
  // now exactly ONE verification gate, and every one of these named
  // failure reasons flows through the same bounded-retry-then-rollback
  // path, never a separate unprotected job.
  const namedVerificationFailureReasons: Array<{ name: string; detail: string }> = [
    {
      name: 'root HTTP/content failure',
      detail: 'root HTML did not contain recognizable AIscentra content',
    },
    { name: 'health failure', detail: 'health .status was "degraded", expected "ok"' },
    {
      name: 'SHA mismatch',
      detail: 'githubCommitSha mismatch: got old-sha, expected abc123deadbeef',
    },
    { name: 'missing required Open Graph tag', detail: 'missing required og:image meta tag' },
    {
      name: 'Open Graph image non-200',
      detail: 'Open Graph image returned HTTP 404, expected 200',
    },
    {
      name: 'Open Graph image invalid PNG signature',
      detail: 'PNG signature mismatch: got deadbeef00000000, expected 89504e470d0a1a0a',
    },
    { name: 'www routing failure', detail: 'root path HTTP 404' },
  ]

  for (const reason of namedVerificationFailureReasons) {
    test(`verification failure (${reason.name}) -> rollback of both domains`, async () => {
      const getCurrentHolder: GetCurrentHolderFn = async () => OLD_ID
      const setCalls: Array<{ domain: string; deploymentId: string }> = []
      const setAlias: SetAliasFn = async (domain, deploymentId) => {
        setCalls.push({ domain, deploymentId })
        return { ok: true }
      }
      const verifyDomain: VerifyDomainFn = async () => ({ ok: false, detail: reason.detail })

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

      assert.equal(result.status, 'PUBLIC RELEASE NOT VERIFIED — ROLLBACK ATTEMPTED')
      for (const d of result.diagnostics.domains) {
        assert.equal(d.assignSucceeded, true)
        assert.equal(d.rolledBack, true)
        assert.equal(d.rollbackSucceeded, true)
      }
      const rollbackCalls = setCalls.filter((c) => c.deploymentId === OLD_ID)
      assert.equal(rollbackCalls.length, DOMAINS.length)
      assert.ok(result.diagnostics.verification.some((v) => v.detail === reason.detail))
    })
  }

  test('workflow graph: no blocking post-cutover job exists outside the rollback boundary', () => {
    const workflowPath = join(
      __dirname,
      '..',
      '..',
      '..',
      '.github',
      'workflows',
      'production-release.yml',
    )
    const workflowText = readFileSync(workflowPath, 'utf-8')

    // The removed job must not exist under any name/spelling that was
    // previously used for the unprotected post-cutover checks.
    assert.equal(
      /^\s*post-promotion-smoke:\s*$/m.test(workflowText),
      false,
      "post-promotion-smoke job must not exist -- its checks were merged into domain-cutover's own verifyDomain",
    )

    // domain-cutover must exist, and no OTHER job may declare it as a
    // dependency (which would imply a downstream job running after a
    // successful cutover, outside the rollback boundary).
    assert.ok(/^\s*domain-cutover:\s*$/m.test(workflowText), 'domain-cutover job must exist')
    assert.equal(
      /needs:\s*(\[[^\]]*\bdomain-cutover\b[^\]]*\]|domain-cutover\b)/.test(
        workflowText.replace(/domain-cutover:\n(?:.*\n)*?(?=^  \S|\Z)/m, ''),
      ),
      false,
      'no job may declare needs: domain-cutover -- nothing may run after a successful cutover outside its own rollback boundary',
    )
  })
})

describe('pure content-check functions (unit, no network)', () => {
  test('checkRootContent: recognizes AIscentra content, rejects unrelated content', () => {
    assert.equal(checkRootContent('<html>AIscentra Intelligence Observatory</html>').ok, true)
    assert.equal(checkRootContent('<html>Some unrelated page</html>').ok, false)
  })

  test('checkHealthJson: requires status=ok AND checks.database=ok', () => {
    assert.equal(checkHealthJson({ status: 'ok', checks: { database: 'ok' } }).ok, true)
    assert.equal(checkHealthJson({ status: 'degraded', checks: { database: 'ok' } }).ok, false)
    assert.equal(checkHealthJson({ status: 'ok', checks: { database: 'down' } }).ok, false)
    assert.equal(checkHealthJson({}).ok, false)
  })

  test('checkCommitSha: exact match only', () => {
    assert.equal(checkCommitSha('abc123', 'abc123').ok, true)
    assert.equal(checkCommitSha('abc999', 'abc123').ok, false)
    assert.equal(checkCommitSha(undefined, 'abc123').ok, false)
  })

  test('extractOpenGraphImageUrl + checkOpenGraphTagPresent: finds og:image in either attribute order, reports missing tag', () => {
    const htmlNormalOrder =
      '<meta property="og:image" content="https://aiscentra.com/opengraph-image">'
    const htmlReversedOrder =
      '<meta content="https://aiscentra.com/opengraph-image" property="og:image">'
    const htmlMissing = '<meta property="og:title" content="AIscentra">'

    assert.equal(extractOpenGraphImageUrl(htmlNormalOrder), 'https://aiscentra.com/opengraph-image')
    assert.equal(
      extractOpenGraphImageUrl(htmlReversedOrder),
      'https://aiscentra.com/opengraph-image',
    )
    assert.equal(extractOpenGraphImageUrl(htmlMissing), null)

    assert.equal(checkOpenGraphTagPresent(htmlNormalOrder).ok, true)
    assert.equal(checkOpenGraphTagPresent(htmlMissing).ok, false)
  })

  test('checkOpenGraphImageStatus: only HTTP 200 passes', () => {
    assert.equal(checkOpenGraphImageStatus(200).ok, true)
    assert.equal(checkOpenGraphImageStatus(404).ok, false)
    assert.equal(checkOpenGraphImageStatus(500).ok, false)
  })

  test('checkOpenGraphImageContentType: requires image/png prefix, rejects null/other', () => {
    assert.equal(checkOpenGraphImageContentType('image/png').ok, true)
    assert.equal(checkOpenGraphImageContentType('image/png; charset=binary').ok, true)
    assert.equal(checkOpenGraphImageContentType('text/html').ok, false)
    assert.equal(checkOpenGraphImageContentType(null).ok, false)
  })

  test('checkPngSignature: exact hex match only, case-insensitive', () => {
    const realSig = '89504e470d0a1a0a'
    assert.equal(checkPngSignature(realSig, realSig).ok, true)
    assert.equal(checkPngSignature(realSig.toUpperCase(), realSig).ok, true)
    assert.equal(checkPngSignature('deadbeef00000000', realSig).ok, false)
  })
})
