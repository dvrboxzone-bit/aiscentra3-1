/**
 * AIscentra — Domain Cutover Runner (Phase 1C-B2 correction)
 *
 * Thin executable wrapper around planDomainCutover(). All the decision
 * logic lives in domain-cutover.ts and is covered by
 * scripts/release/__tests__/domain-cutover.test.ts; this file only
 * wires that logic to the real Vercel CLI and real HTTP checks, reads
 * required environment variables, writes the safe diagnostic artifact,
 * and sets the process exit code.
 *
 * Required environment variables (all already present in
 * production-release.yml's existing env: blocks -- no new secrets
 * introduced):
 *   VERCEL_TOKEN           -- read only to pass through to the CLI/API,
 *                             never logged or included in the artifact
 *   VERCEL_TEAM_SLUG        -- Team slug, used for CLI --scope
 *   VERCEL_CLI_VERSION      -- pinned CLI version, e.g. 58.4.4
 *   STAGED_DEPLOYMENT_ID    -- the staged, already smoke-tested deployment
 *   COMMIT_SHA              -- expected commit SHA for final verification
 *   PRODUCTION_ALIAS_1      -- e.g. aiscentra.com
 *   PRODUCTION_ALIAS_2      -- e.g. www.aiscentra.com
 *   CUTOVER_ARTIFACT_PATH   -- where to write the safe diagnostic JSON
 *
 * Exit code is 0 only for CUTOVER_SUCCESS. Every other status exits 1.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'

import {
  planDomainCutover,
  toSafeArtifact,
  type GetCurrentHolderFn,
  type SetAliasFn,
  type VerifyDomainFn,
} from './domain-cutover'

const execFileAsync = promisify(execFile)

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set.`)
  }
  return value
}

async function main(): Promise<void> {
  const vercelToken = requireEnv('VERCEL_TOKEN')
  const vercelTeamSlug = requireEnv('VERCEL_TEAM_SLUG')
  const vercelCliVersion = requireEnv('VERCEL_CLI_VERSION')
  const stagedDeploymentId = requireEnv('STAGED_DEPLOYMENT_ID')
  const targetCommitSha = requireEnv('COMMIT_SHA')
  const alias1 = requireEnv('PRODUCTION_ALIAS_1')
  const alias2 = requireEnv('PRODUCTION_ALIAS_2')
  const artifactPath = requireEnv('CUTOVER_ARTIFACT_PATH')

  const domains = [alias1, alias2]

  async function runVercel(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(
      'npx',
      [
        '--yes',
        `vercel@${vercelCliVersion}`,
        ...args,
        '--token',
        vercelToken,
        '--scope',
        vercelTeamSlug,
      ],
      { env: process.env, maxBuffer: 10 * 1024 * 1024 },
    )
  }

  const getCurrentHolder: GetCurrentHolderFn = async (domain) => {
    try {
      const { stdout } = await runVercel(['inspect', domain, '--json'])
      const parsed = JSON.parse(stdout) as { id?: unknown }
      if (typeof parsed.id === 'string' && parsed.id.length > 0) {
        return parsed.id
      }
      return null
    } catch {
      // Any failure to unambiguously determine the current holder
      // (domain not aliased yet, malformed response, CLI error) must
      // be treated as "undetermined", never guessed.
      return null
    }
  }

  const setAlias: SetAliasFn = async (domain, deploymentId) => {
    try {
      await runVercel(['alias', 'set', deploymentId, domain])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const verifyDomain: VerifyDomainFn = async (domain, expectedCommitSha) => {
    try {
      const rootResp = await fetch(`https://${domain}/`)
      if (rootResp.status !== 200) {
        return { ok: false, detail: `root path HTTP ${rootResp.status}` }
      }
      const rootText = await rootResp.text()
      if (!/aiscentra/i.test(rootText)) {
        return { ok: false, detail: 'root path did not contain recognizable AIscentra content' }
      }

      const healthResp = await fetch(`https://${domain}/api/health`)
      if (healthResp.status !== 200) {
        return { ok: false, detail: `health path HTTP ${healthResp.status}` }
      }
      const health = (await healthResp.json()) as {
        status?: unknown
        checks?: { database?: unknown }
      }
      if (health.status !== 'ok' || health.checks?.database !== 'ok') {
        return { ok: false, detail: 'health check did not report ok/ok' }
      }

      const { stdout } = await runVercel(['inspect', domain, '--json'])
      const parsed = JSON.parse(stdout) as { meta?: { githubCommitSha?: unknown } }
      const actualSha = parsed.meta?.githubCommitSha
      if (actualSha !== expectedCommitSha) {
        return { ok: false, detail: `githubCommitSha mismatch: got ${String(actualSha)}` }
      }

      return { ok: true, detail: 'root 200 + health ok/ok + sha match' }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  }

  const result = await planDomainCutover({
    domains,
    stagedDeploymentId,
    targetCommitSha,
    getCurrentHolder,
    setAlias,
    verifyDomain,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })

  const safe = toSafeArtifact(result)
  writeFileSync(artifactPath, JSON.stringify(safe, null, 2))

  console.log(`Domain cutover status: ${result.status}`)
  console.log(JSON.stringify(safe, null, 2))

  if (result.status !== 'CUTOVER_SUCCESS') {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('::error::Domain cutover runner crashed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
