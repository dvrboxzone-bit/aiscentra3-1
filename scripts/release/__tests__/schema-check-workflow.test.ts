/**
 * AIscentra — production-release.yml protected release job structure test
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
const schemaGateSrc = (): string => readFileSync('scripts/release/schema-check.sql', 'utf8')

/** Extracts the raw text of the `production-release:` job block, up to the
 * next top-level (2-space-indented) job key. */
function extractProductionReleaseJob(src: string): string {
  const startMatch = /^ {2}production-release:\r?\n/m.exec(src)
  assert.ok(startMatch, 'production-release job must exist in the workflow')
  const start = startMatch.index
  const rest = src.slice(start + startMatch[0].length)
  const nextJobMatch = /^ {2}[a-zA-Z0-9_-]+:\r?\n/m.exec(rest)
  const end = nextJobMatch ? start + startMatch[0].length + nextJobMatch.index : src.length
  return src.slice(start, end)
}

describe('production-release.yml — schema-check job has a real checkout before the SQL verification step', () => {
  test('a checkout step is present in the schema-check job', () => {
    const job = extractProductionReleaseJob(workflowSrc())
    assert.match(
      job,
      /uses:\s*actions\/checkout@/,
      'schema-check must include an actions/checkout step -- without one, the relative path to scripts/release/schema-check.sql does not exist on the runner',
    )
  })

  test('the checkout step appears BEFORE the SQL verification step, not after', () => {
    const job = extractProductionReleaseJob(workflowSrc())
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
    const job = extractProductionReleaseJob(workflowSrc())
    assert.match(
      job,
      /ref:\s*\$\{\{\s*needs\.validate\.outputs\.commit_sha\s*\}\}/,
      "the checkout ref must be the exact release SHA (needs.validate.outputs.commit_sha) -- checking out a branch instead could silently verify the wrong commit's migrations against production",
    )
  })

  test('the checkout uses fetch-depth: 1 and persist-credentials: false, matching the minimal, credential-safe checkout already used elsewhere in this workflow', () => {
    const job = extractProductionReleaseJob(workflowSrc())
    assert.match(job, /fetch-depth:\s*1\b/)
    assert.match(job, /persist-credentials:\s*false\b/)
  })

  test('the protected release job depends on validate, so needs.validate.outputs.commit_sha is genuinely available', () => {
    const job = extractProductionReleaseJob(workflowSrc())
    assert.match(job, /needs:\s*\[[^\]]*\bvalidate\b[^\]]*\]/)
  })
})

describe('production schema gate — Signal Quality Foundation dependencies', () => {
  test('requires the enum, every quality column, and the append-only decision ledger', () => {
    const gate = schemaGateSrc()
    assert.match(gate, /\('signal_quality_state'\)/)
    for (const label of ['PENDING', 'APPROVED', 'QUARANTINED']) {
      assert.match(gate, new RegExp(`\\('signal_quality_state', '${label}'\\)`))
    }
    for (const column of [
      'quality_state',
      'quality_reason_codes',
      'quality_rule_version',
      'quality_evaluated_at',
      'quarantined_at',
    ]) {
      assert.match(gate, new RegExp(`\\('signals', '${column}'\\)`))
    }
    assert.match(gate, /\('signal_quality_decisions'\)/)
    for (const dependency of [
      'prevent_signal_quality_decision_mutation',
      'record_signal_quality_decision',
      'signal_quality_decisions_no_update_delete',
      'signal_quality_decisions_no_truncate',
      'signals_quality_decision_on_insert',
      'signals_quality_decision_on_state_change',
    ]) {
      assert.match(gate, new RegExp(dependency))
    }
  })

  test('requires both Signal quality constraints', () => {
    const gate = schemaGateSrc()
    assert.match(gate, /signals_quality_state_metadata_check/)
    assert.match(gate, /signals_quality_approved_v2_invariants_check/)
  })

  test('requires enabled Event and Report database guard triggers and their functions', () => {
    const gate = schemaGateSrc()
    for (const dependency of [
      'enforce_quality_approved_event_origin',
      'enforce_quality_approved_report_publication',
      'events_require_quality_approved_signal_on_insert',
      'events_require_quality_approved_signal_on_update',
      'reports_require_quality_approved_evidence_on_insert',
      'reports_require_quality_approved_evidence_on_update',
    ]) {
      assert.match(gate, new RegExp(dependency))
    }
    assert.match(gate, /t\.tgenabled <> 'D'/)
  })
})

describe('production-release.yml — one approval boundary and no release-time data mutation', () => {
  test('exactly one job uses the protected production environment', () => {
    const matches = workflowSrc().match(/^ {4}environment:\s*production\s*$/gm) ?? []
    assert.equal(matches.length, 1)
  })

  test('the single protected job contains stage, metadata, smoke, TOCTOU and cutover in order', () => {
    const job = extractProductionReleaseJob(workflowSrc())
    const orderedMarkers = [
      '# staged-deploy',
      '# deployment-metadata-gate',
      '# staged-smoke',
      '# pre-promotion-recheck',
      '# domain-cutover',
    ]
    let previous = -1
    for (const marker of orderedMarkers) {
      const current = job.indexOf(marker)
      assert.ok(current > previous, `${marker} must exist after the previous protected phase`)
      previous = current
    }
  })

  test('release workflow contains no priority backfill job or verify-urls mutation call', () => {
    const source = workflowSrc()
    assert.doesNotMatch(source, /priority-backfill|priorityOnly|\/api\/cron\/verify-urls/)
  })
})
