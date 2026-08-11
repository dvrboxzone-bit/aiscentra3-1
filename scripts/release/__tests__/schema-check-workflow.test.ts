/**
 * AIscentra — production-release.yml schema-check job structure test
 *
 * Real production incident this guards against: the `schema-check`
 * job previously had NO checkout step at all -- the repository was
 * never cloned into the runner, so the relative path
 * `scripts/release/schema-check.sql` referenced by the SQL-
 * verification step did not exist, and psql failed with "No such
 * file or directory". This was masked across two earlier production-
 * release attempts by an unrelated network-connectivity failure
 * (SUPABASE_DB_URL pointing at an IPv6-only host unreachable from the
 * runner); once that was fixed, this separate, genuine defect
 * surfaced on its own during an actual production release.
 *
 * Source-level text assertions on the workflow YAML itself --
 * matching the same technique already used elsewhere in this project
 * (e.g. route-security.test.ts) -- deliberately avoiding a new YAML-
 * parsing dependency for a single regression test.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflowSrc = (): string => readFileSync('.github/workflows/production-release.yml', 'utf8')

/** Extracts the raw text of the `schema-check:` job block, up to the
 * next top-level (2-space-indented) job key. */
function extractSchemaCheckJob(src: string): string {
  const startMatch = /^ {2}schema-check:\n/m.exec(src)
  assert.ok(startMatch, 'schema-check job must exist in the workflow')
  const start = startMatch.index
  const rest = src.slice(start + startMatch[0].length)
  const nextJobMatch = /^ {2}[a-zA-Z0-9_-]+:\n/m.exec(rest)
  const end = nextJobMatch ? start + startMatch[0].length + nextJobMatch.index : src.length
  return src.slice(start, end)
}

describe('production-release.yml — schema-check job has a real checkout before the SQL verification step', () => {
  test('a checkout step is present in the schema-check job', () => {
    const job = extractSchemaCheckJob(workflowSrc())
    assert.match(
      job,
      /uses:\s*actions\/checkout@/,
      'schema-check must include an actions/checkout step -- without one, the relative path to scripts/release/schema-check.sql does not exist on the runner',
    )
  })

  test('the checkout step appears BEFORE the SQL verification step, not after', () => {
    const job = extractSchemaCheckJob(workflowSrc())
    const checkoutIdx = job.search(/uses:\s*actions\/checkout@/)
    const verifyIdx = job.indexOf('psql "$SUPABASE_DB_URL"')
    assert.ok(checkoutIdx >= 0, 'checkout step must exist')
    assert.ok(verifyIdx >= 0, 'the psql verification call must exist')
    assert.ok(
      checkoutIdx < verifyIdx,
      'checkout must run BEFORE the psql call, or the SQL file will not exist yet on the runner',
    )
  })

  test('the checkout uses the exact release commit_sha (validate job output), not a branch name or default ref', () => {
    const job = extractSchemaCheckJob(workflowSrc())
    assert.match(
      job,
      /ref:\s*\$\{\{\s*needs\.validate\.outputs\.commit_sha\s*\}\}/,
      "the checkout ref must be the exact release SHA (needs.validate.outputs.commit_sha) -- checking out a branch instead could silently verify the wrong commit's migrations against production",
    )
  })

  test('the checkout uses fetch-depth: 1 and persist-credentials: false, matching the minimal, credential-safe checkout already used elsewhere in this workflow', () => {
    const job = extractSchemaCheckJob(workflowSrc())
    assert.match(job, /fetch-depth:\s*1\b/)
    assert.match(job, /persist-credentials:\s*false\b/)
  })

  test('schema-check depends on the validate job, so needs.validate.outputs.commit_sha is genuinely available', () => {
    const job = extractSchemaCheckJob(workflowSrc())
    assert.match(job, /needs:\s*\[[^\]]*\bvalidate\b[^\]]*\]/)
  })
})
