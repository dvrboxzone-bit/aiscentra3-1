#!/usr/bin/env node
/**
 * AIscentra — CLI wrapper for decideBackfillAction, invoked from
 * production-release.yml's priority-backfill job.
 *
 * Usage: node priority-backfill-decide.mjs <httpStatus> <bodyJsonPath> <attempt> <maxAttempts> <elapsedMs> <maxElapsedMs>
 * Prints exactly one line: "success|retry|fail <reason>"
 * Exit code: 0 for success/retry, 1 for fail -- so the calling bash
 * step can react with simple `if` logic without re-parsing JSON
 * itself, keeping the actual decision logic in the one real, tested
 * TypeScript module (priority-backfill.ts) rather than duplicated in
 * bash.
 */
import { readFileSync } from 'node:fs'
import { decideBackfillAction } from './priority-backfill'

const [, , httpStatusArg, bodyPath, attemptArg, maxAttemptsArg, elapsedMsArg, maxElapsedMsArg] =
  process.argv

let parsedBody: unknown = null
try {
  if (!bodyPath) throw new Error('no body path given')
  const raw = readFileSync(bodyPath, 'utf8')
  parsedBody = JSON.parse(raw)
} catch {
  parsedBody = null
}

const decision = decideBackfillAction(Number(httpStatusArg), parsedBody, {
  attempt: Number(attemptArg),
  maxAttempts: Number(maxAttemptsArg),
  elapsedMs: Number(elapsedMsArg),
  maxElapsedMs: Number(maxElapsedMsArg),
})

console.log(`${decision.action} ${decision.reason}`)
process.exit(decision.action === 'fail' ? 1 : 0)
