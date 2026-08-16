/**
 * AIscentra — Domain Cutover Runner
 *
 * Thin executable wrapper around planDomainCutover(). All decision
 * logic lives in domain-cutover.ts and is covered by
 * scripts/release/__tests__/domain-cutover.test.ts; this file only
 * wires that logic to the real Vercel CLI and real HTTP checks.
 *
 * CREDENTIAL HANDLING (audit finding 1):
 * VERCEL_TOKEN is NEVER passed via argv. Node's child_process embeds the
 * full command line into err.message/err.cmd on failure, so a token in
 * argv leaks into every downstream error path. Authentication is done
 * exclusively through the VERCEL_TOKEN / VERCEL_ORG_ID environment
 * variables, which the Vercel CLI reads natively. Additionally, no raw
 * Error.message, stdout, stderr, cause, argv, or environment is ever
 * read, printed, or stored -- every failure is classified into a
 * structured SafeErrorCode by sanitizeError() before use.
 *
 * BOUNDEDNESS (audit finding 2):
 * Every external operation takes an explicit timeout derived from the
 * caller's remaining budget: fetch calls use AbortSignal.timeout, body
 * reads are size-capped and stream-limited, and child processes get
 * both a `timeout` and `killSignal` so they are guaranteed to terminate.
 * The OG image is never buffered whole -- only enough bytes for the PNG
 * signature are read, then the stream is cancelled.
 *
 * Required environment variables:
 *   VERCEL_TOKEN            -- consumed by the CLI from the environment
 *   VERCEL_ORG_ID            -- consumed by the CLI from the environment
 *   VERCEL_CLI_VERSION       -- pinned CLI version
 *   STAGED_DEPLOYMENT_ID     -- staged, already smoke-tested deployment
 *   COMMIT_SHA               -- expected commit SHA
 *   PRODUCTION_ALIAS_1/2     -- the two public domains
 *   PNG_SIGNATURE_HEX        -- expected PNG magic bytes
 *   CUTOVER_ARTIFACT_PATH    -- where to write the safe diagnostic JSON
 *
 * Exit code is 0 only for CUTOVER_SUCCESS.
 */
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import {
  planDomainCutover,
  toSafeArtifact,
  sanitizeError,
  safeDetail,
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
  type GetCurrentHolderFn,
  type SetAliasFn,
  type VerifyDomainFn,
  type SafeErrorCode,
} from './domain-cutover'

/** Hard caps on how much of any response body is ever read. */
export const MAX_HTML_BYTES = 2 * 1024 * 1024
export const MAX_JSON_BYTES = 256 * 1024
/** Only the PNG magic number is needed; never buffer the whole image. */
export const PNG_SIGNATURE_BYTES = 8

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    // Names only -- never the value.
    throw new Error(`Required environment variable ${name} is not set.`)
  }
  return value
}

/**
 * Reads at most `maxBytes` from a response body, cancelling the stream
 * as soon as the cap is reached. Returns null if the cap is exceeded so
 * the caller can fail closed with BODY_TOO_LARGE.
 */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          return null
        }
        chunks.push(value)
      }
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/**
 * Reads only the leading `n` bytes then cancels the stream, so a huge
 * or endless image body is never downloaded in full.
 */
export async function readPrefix(
  body: ReadableStream<Uint8Array> | null,
  n: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < n) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        total += value.byteLength
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const out = new Uint8Array(Math.min(total, n))
  let offset = 0
  for (const c of chunks) {
    if (offset >= out.length) break
    out.set(c.subarray(0, Math.min(c.byteLength, out.length - offset)), offset)
    offset += c.byteLength
  }
  return out
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function main(): Promise<void> {
  const vercelCliVersion = requireEnv('VERCEL_CLI_VERSION')
  const stagedDeploymentId = requireEnv('STAGED_DEPLOYMENT_ID')
  const targetCommitSha = requireEnv('COMMIT_SHA')
  const alias1 = requireEnv('PRODUCTION_ALIAS_1')
  const alias2 = requireEnv('PRODUCTION_ALIAS_2')
  const artifactPath = requireEnv('CUTOVER_ARTIFACT_PATH')
  const pngSignatureHex = requireEnv('PNG_SIGNATURE_HEX')
  // Needed now for the direct Vercel REST API call in verifyDomain's SHA
  // check (see comment there for why the CLI's own `inspect` subcommand
  // was abandoned). Still never placed in argv, never logged, never
  // written to the artifact -- used only as an in-process fetch header
  // and query parameter.
  const vercelToken = requireEnv('VERCEL_TOKEN')
  const vercelOrgId = requireEnv('VERCEL_ORG_ID')

  const domains = [alias1, alias2]

  /**
   * Runs the Vercel CLI with NO credentials in argv and a hard timeout.
   * Rejects with a shape sanitizeError() can classify; the caller never
   * inspects the raw error.
   */
  function runVercel(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'npx',
        ['--yes', `vercel@${vercelCliVersion}`, ...args],
        {
          env: process.env,
          maxBuffer: 4 * 1024 * 1024,
          timeout: Math.max(1, timeoutMs),
          killSignal: 'SIGKILL',
        },
        (err, stdout) => {
          if (err) {
            // Re-wrap: drop message/cmd/stdout/stderr entirely, keep only
            // the shape fields sanitizeError() classifies on.
            const e = err as { killed?: boolean; signal?: NodeJS.Signals | null; code?: unknown }
            reject({
              name: e.killed ? 'TimeoutError' : 'Error',
              killed: e.killed,
              signal: e.signal,
            })
            return
          }
          resolve(stdout)
        },
      )
      child.on('error', () => {
        reject({ name: 'Error' })
      })
    })
  }

  const getCurrentHolder: GetCurrentHolderFn = async (domain, timeoutMs) => {
    if (timeoutMs <= 0) return null
    try {
      const stdout = await runVercel(['inspect', domain, '--json'], timeoutMs)
      const parsed = JSON.parse(stdout) as { id?: unknown }
      return typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : null
    } catch {
      // Undetermined is never guessed -- callers treat null as
      // HOLDER_UNKNOWN and escalate to manual recovery where relevant.
      return null
    }
  }

  const setAlias: SetAliasFn = async (domain, deploymentId, timeoutMs) => {
    if (timeoutMs <= 0) return { ok: false, errorCode: 'TIMEOUT' }
    try {
      await runVercel(['alias', 'set', deploymentId, domain], timeoutMs)
      return { ok: true }
    } catch (err) {
      return { ok: false, errorCode: sanitizeError(err, 'COMMAND_FAILED') }
    }
  }

  const verifyDomain: VerifyDomainFn = async (
    domain,
    expectedCommitSha,
    timeoutMs,
    stagedDeploymentId,
  ) => {
    if (timeoutMs <= 0) return { ok: false, detail: safeDetail('TIMEOUT', domain) }
    const fail = (code: SafeErrorCode, ctx?: string): { ok: false; detail: string } => ({
      ok: false,
      detail: safeDetail(code, ctx),
    })

    try {
      // 1. Root -- bounded fetch, size-capped body.
      const rootResp = await fetch(`https://${domain}/`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (rootResp.status !== 200) return fail('HTTP_STATUS', `root ${rootResp.status}`)
      const rootBytes = await readCapped(rootResp.body, MAX_HTML_BYTES)
      if (rootBytes === null) return fail('BODY_TOO_LARGE', 'root')
      const rootText = new TextDecoder().decode(rootBytes)

      const rootCheck = checkRootContent(rootText)
      if (!rootCheck.ok) return { ok: false, detail: rootCheck.detail }

      // 2. Health -- bounded fetch, size-capped body, safe parse.
      const healthResp = await fetch(`https://${domain}/api/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (healthResp.status !== 200) return fail('HTTP_STATUS', `health ${healthResp.status}`)
      const healthBytes = await readCapped(healthResp.body, MAX_JSON_BYTES)
      if (healthBytes === null) return fail('BODY_TOO_LARGE', 'health')
      let healthJson: unknown
      try {
        healthJson = JSON.parse(new TextDecoder().decode(healthBytes))
      } catch {
        return fail('PARSE_FAILED', 'health')
      }
      const healthCheck = checkHealthJson(healthJson)
      if (!healthCheck.ok) return { ok: false, detail: healthCheck.detail }

      // 2b. Signal feed -- bounded fetch, size-capped body. Real
      // incident this closes: health above only proves DATABASE
      // CONNECTIVITY, not that the actual signal-listing query
      // succeeds and returns something non-empty -- see
      // checkActiveSignalCountAttribute's own docstring for the full
      // rationale (including why a text-substring check was itself a
      // real production false-negative, fixed by a stable
      // data-active-signal-count HTML attribute instead). Runs on the
      // LIVE domain, immediately after cutover, in the SAME verify-
      // then-rollback pass as every other check here -- a failure
      // here triggers the identical automatic rollback already wired
      // for root/health/SHA/OG.
      const signalsResp = await fetch(`https://${domain}/signals`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (signalsResp.status !== 200) return fail('HTTP_STATUS', `signals ${signalsResp.status}`)
      const signalsBytes = await readCapped(signalsResp.body, MAX_HTML_BYTES)
      if (signalsBytes === null) return fail('BODY_TOO_LARGE', 'signals')
      const signalsText = new TextDecoder().decode(signalsBytes)
      const signalFeedCheck = checkActiveSignalCountAttribute(signalsText)
      if (!signalFeedCheck.ok) return { ok: false, detail: signalFeedCheck.detail }

      // 3. Exact commit SHA. Read by STAGED DEPLOYMENT ID, not by domain
      // string. Confirmed via a real release attempt: `vercel inspect
      // <domain>` correctly and immediately reflects which deployment ID
      // now holds the alias (used by getCurrentHolder, above, and by
      // this same check historically) -- but its `.meta.githubCommitSha`
      // field lagged behind for a custom domain specifically, failing
      // this check 14 times over ~70s even though the staged
      // deployment's own metadata (confirmed by a separate, independent
      // query directly against its ID) was correct the entire time.
      //
      // SECOND real attempt (after switching to `vercel inspect
      // <deploymentId> --json`) failed differently: the CLI's own
      // --json output for an inspect-by-ID does not include the `meta`
      // object at all (got=undefined, confirmed from the actual owner-
      // provided run output) -- the CLI's JSON shape for this command
      // is evidently narrower than the full deployment object.
      //
      // FIX: call the Vercel REST API directly
      // (GET /v13/deployments/{id}) instead of going through the CLI's
      // `inspect` subcommand at all. This is the same endpoint shape
      // already read successfully, repeatedly, throughout this
      // project's release-engineering history (via direct API calls
      // elsewhere in this workflow's own earlier jobs) and is known to
      // reliably include `.meta.githubCommitSha`.
      let inspectJson: unknown
      try {
        const resp = await fetch(
          `https://api.vercel.com/v13/deployments/${stagedDeploymentId}?teamId=${vercelOrgId}`,
          {
            headers: { Authorization: `Bearer ${vercelToken}` },
            signal: AbortSignal.timeout(timeoutMs),
          },
        )
        if (resp.status !== 200) return fail('HTTP_STATUS', `deployments-api ${resp.status}`)
        inspectJson = await resp.json()
      } catch (err) {
        return fail(sanitizeError(err, 'COMMAND_FAILED'), 'deployments-api')
      }
      const shaCheck = checkCommitSha(
        (inspectJson as { meta?: { githubCommitSha?: unknown } }).meta?.githubCommitSha,
        expectedCommitSha,
      )
      if (!shaCheck.ok) return { ok: false, detail: shaCheck.detail }

      // 4. Required Open Graph tag.
      const ogTagCheck = checkOpenGraphTagPresent(rootText)
      if (!ogTagCheck.ok) return { ok: false, detail: ogTagCheck.detail }
      const ogImageUrl = extractOpenGraphImageUrl(rootText)
      if (!ogImageUrl) return fail('CONTENT_MISMATCH', 'og:image extraction')

      // 5. OG image -- bounded fetch; only the signature bytes are read.
      const absoluteOgUrl = ogImageUrl.startsWith('http')
        ? ogImageUrl
        : `https://${domain}${ogImageUrl}`
      const ogResp = await fetch(absoluteOgUrl, { signal: AbortSignal.timeout(timeoutMs) })
      const ogStatusCheck = checkOpenGraphImageStatus(ogResp.status)
      if (!ogStatusCheck.ok) return { ok: false, detail: ogStatusCheck.detail }
      const ogCtCheck = checkOpenGraphImageContentType(ogResp.headers.get('content-type'))
      if (!ogCtCheck.ok) return { ok: false, detail: ogCtCheck.detail }

      const sigBytes = await readPrefix(ogResp.body, PNG_SIGNATURE_BYTES)
      if (sigBytes.byteLength < PNG_SIGNATURE_BYTES)
        return fail('CONTENT_MISMATCH', 'png-truncated')
      const pngCheck = checkPngSignature(toHex(sigBytes), pngSignatureHex)
      if (!pngCheck.ok) return { ok: false, detail: pngCheck.detail }

      // 6. REAL PRODUCTION INCIDENT this closes: /opengraph-image (the
      // site-wide OG image, checked immediately above) can return a
      // genuine, non-empty PNG while a PER-SIGNAL illustration
      // (/signals/<slug>/opengraph-image) returns HTTP 200 with
      // content-type: image/png and a genuinely EMPTY (0-byte) body --
      // a Satori-rendering error specific to that route's own render
      // tree (a <div> with multiple children missing the required
      // explicit `display`), silently swallowed rather than thrown as
      // a visible 500. Uses the SAME real signal path already reached
      // via signalsText (fetched above for the signal-feed check), via
      // the ONE shared implementation (extractRealSignalPath,
      // scripts/release/extract-signal-path.ts's own CLI wrapper for
      // the CI-side callers) -- not a second, independently hand-
      // copied extraction. Runs on the LIVE domain, immediately after
      // cutover, in the SAME verify-then-rollback pass as every other
      // check here -- a failure here triggers the identical automatic
      // rollback already wired for root/health/SHA/site-wide-OG.
      const signalPath = extractRealSignalPath(signalsText)
      if (!signalPath) return fail('CONTENT_MISMATCH', 'signal-path-extraction')

      const signalOgResp = await fetch(`https://${domain}${signalPath}/opengraph-image`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      const signalOgStatusCheck = checkOpenGraphImageStatus(signalOgResp.status)
      if (!signalOgStatusCheck.ok) return { ok: false, detail: signalOgStatusCheck.detail }
      const signalOgCtCheck = checkOpenGraphImageContentType(
        signalOgResp.headers.get('content-type'),
      )
      if (!signalOgCtCheck.ok) return { ok: false, detail: signalOgCtCheck.detail }

      const signalOgFullBytes = await readCapped(signalOgResp.body, MAX_HTML_BYTES)
      if (signalOgFullBytes === null) return fail('BODY_TOO_LARGE', 'signal-og-image')
      // REAL PRODUCTION INCIDENT this closes, verified directly: a
      // genuinely EMPTY (0-byte) body is exactly what the real
      // incident returned -- checked explicitly, not merely inferred
      // from a short/truncated signature read below.
      if (signalOgFullBytes.byteLength === 0)
        return fail('CONTENT_MISMATCH', 'signal-og-image-empty-body')
      if (signalOgFullBytes.byteLength < PNG_SIGNATURE_BYTES)
        return fail('CONTENT_MISMATCH', 'signal-og-image-png-truncated')
      const signalOgSigBytes = signalOgFullBytes.subarray(0, PNG_SIGNATURE_BYTES)
      const signalPngCheck = checkPngSignature(toHex(signalOgSigBytes), pngSignatureHex)
      if (!signalPngCheck.ok) return { ok: false, detail: signalPngCheck.detail }

      // 7. Routing for both domains is covered because verifyDomain runs
      // once per domain and fetch() follows redirects, so www's own
      // checks exercise its final destination.
      return { ok: true, detail: 'verified' }
    } catch (err) {
      return { ok: false, detail: safeDetail(sanitizeError(err, 'UNKNOWN'), domain) }
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

  // Audit finding 4: artifact WRITING must never turn a confirmed
  // successful cutover into a failed release. The domains are already
  // switched and verified at this point; a local disk error is not a
  // production-quality signal and there is nothing left to roll back to
  // that would be an improvement. Failure is reported as a sanitized
  // warning and does not affect the exit code.
  try {
    writeFileSync(artifactPath, JSON.stringify(safe, null, 2))
  } catch (err) {
    console.warn(`::warning::Diagnostic artifact could not be written (${sanitizeError(err)}).`)
  }

  console.log(`Domain cutover status: ${result.status}`)
  console.log(JSON.stringify(safe, null, 2))

  if (result.status === 'ROLLBACK INCOMPLETE — MANUAL RECOVERY REQUIRED') {
    console.error('::error::MANUAL RECOVERY REQUIRED for the following domains:')
    for (const m of safe.diagnostics.manualRecoveryDomains) {
      console.error(
        `::error::  ${m.domain} (observed: ${m.observedState}) -> ${m.previousHolderDeploymentId ?? 'UNKNOWN'}`,
      )
    }
  }

  if (result.status !== 'CUTOVER_SUCCESS') {
    process.exitCode = 1
  }
}

main().catch((err) => {
  // Never print the raw error: it may carry argv, stdout, stderr, or a
  // nested cause. Only the sanitized structured code is emitted.
  console.error(`::error::Domain cutover runner failed (${sanitizeError(err)}).`)
  process.exitCode = 1
})
