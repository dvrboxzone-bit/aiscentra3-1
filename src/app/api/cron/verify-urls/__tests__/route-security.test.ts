/**
 * AIscentra — /api/cron/verify-urls route security tests
 *
 * Source-level assertions (the same technique already used elsewhere
 * in this codebase, e.g. budget-gate.test.ts's assertions about
 * agent.ts) proving the three real fixes from the second architectural
 * review are genuinely present in this route's own source:
 * 1. POST, not GET (a GET route with real DB side effects is a
 *    CSRF-adjacent risk).
 * 2. The centralized, constant-time isAuthorizedCronRequest guard is
 *    used, not a per-route `!==` string comparison.
 * 3. No raw Supabase/Postgres error.message is ever returned in a
 *    client-facing NextResponse.json call.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (): string => readFileSync('src/app/api/cron/verify-urls/route.ts', 'utf8')

describe('/api/cron/verify-urls route — security properties', () => {
  test('exports POST, not GET -- a real side-effecting endpoint must not be GET-triggerable', () => {
    const s = src()
    assert.match(s, /export async function POST\(/)
    assert.doesNotMatch(s, /export async function GET\(/)
  })

  test('uses the centralized, constant-time cron guard -- not a per-route !== comparison', () => {
    const s = src()
    assert.match(
      s,
      /import\s*\{\s*isAuthorizedCronRequest\s*\}\s*from\s*'@\/lib\/security\/cron-guard'/,
    )
    assert.match(s, /isAuthorizedCronRequest\(request\)/)
    assert.doesNotMatch(
      s,
      /authHeader\s*!==\s*`Bearer/,
      'must not reintroduce a raw string comparison against the secret',
    )
  })

  test('no raw error.message from a DB/RPC call is ever passed to NextResponse.json -- prevents schema/detail leakage to the caller', () => {
    const s = src()
    // Every NextResponse.json call in this file must not embed a raw
    // `error.message`/`.message` interpolation as a client-visible
    // field. This checks the literal pattern that would leak it.
    assert.doesNotMatch(
      s,
      /NextResponse\.json\(\s*\{\s*error:\s*(\w+\.)?message/,
      'a client-facing response must never embed a raw DB error message directly',
    )
  })

  test('DB/RPC errors are still logged server-side for real debuggability, just not exposed to the client', () => {
    const s = src()
    assert.match(s, /console\.error\('\[cron\/verify-urls\]/)
  })
})

describe('/api/cron/verify-urls route — independent-review fixes (source-level, complementing drainOnePage-level tests above)', () => {
  test('STARTED_AT/DEADLINE_AT are computed INSIDE the POST handler, not at module level -- the real warm-instance bug fix', () => {
    const s = src()
    // Must NOT exist as a module-level (outside any function) const.
    assert.doesNotMatch(
      s,
      /^const (STARTED_AT|DEADLINE_AT)\s*=/m,
      'STARTED_AT/DEADLINE_AT must not be module-level constants -- computed once at cold start, stale on warm invocations',
    )
    // Must exist as local declarations inside POST.
    const postIdx = s.indexOf('export async function POST(')
    const startedAtIdx = s.indexOf('const startedAt = Date.now()')
    assert.ok(startedAtIdx > postIdx, 'startedAt must be declared inside the POST handler')
  })

  test('a genuine database error during backfill produces a real, non-200 HTTP response -- errors are never counted as success', () => {
    const s = src()
    assert.match(
      s,
      /dbErrorEncountered/,
      'must track a genuine DB error distinctly from an empty queue',
    )
    assert.match(
      s,
      /if \(dbErrorEncountered\)[\s\S]{0,600}status:\s*500/,
      'a genuine DB error must produce a real 500 response, not a 200 masked as success',
    )
  })

  test('drainOnePage never masks a DB error as rowsFetched=0-means-empty at the type level', () => {
    const s = src()
    assert.match(
      s,
      /dbError:\s*string \| null/,
      'the page outcome type must carry an explicit dbError field',
    )
  })

  test('a priorityOnly request option exists, for release-time bounded priority backfill (no fire-and-forget)', () => {
    const s = src()
    assert.match(s, /priorityOnly/)
    assert.match(
      s,
      /request\.json\(\)/,
      'must read the option from the real request body, not a hardcoded value',
    )
  })
})

describe('/api/cron/verify-urls route — production incident fixes (FUNCTION_INVOCATION_TIMEOUT during priority backfill)', () => {
  test('priorityOnly gets its own, materially tighter internal time budget (45s), distinct from the general path', () => {
    const s = src()
    assert.match(
      s,
      /PRIORITY_ONLY_BUDGET_MS\s*=\s*45_000/,
      'a real, tighter internal budget must exist specifically for priorityOnly mode',
    )
    assert.match(
      s,
      /priorityOnlyMode\s*\?\s*startedAt \+ PRIORITY_ONLY_BUDGET_MS/,
      'the deadline calculation must actually use the tighter budget when priorityOnlyMode is true',
    )
  })

  test('priorityOnly gets a smaller, fixed page size ("небольшую фиксированную порцию работы за вызов")', () => {
    const s = src()
    assert.match(s, /PRIORITY_ONLY_PAGE_SIZE\s*=\s*10/)
    assert.match(
      s,
      /priorityOnlyMode\s*\?\s*PRIORITY_ONLY_PAGE_SIZE\s*:\s*PAGE_SIZE/,
      'the actual page size used must depend on priorityOnlyMode, not always the general PAGE_SIZE',
    )
  })

  test('reconciliation does not start if the remaining budget is already spent', () => {
    const s = src()
    assert.match(
      s,
      /if \(Date\.now\(\) < deadlineAt\) \{\s*\n\s*const reconciliation = await reconcileStaleGates/,
      'reconcileStaleGates must be gated by a real deadline check, not called unconditionally',
    )
  })

  test('the gate-recompute loop checks the deadline before EACH signal, so the handler can voluntarily stop before the real Vercel cutoff', () => {
    const s = src()
    assert.match(
      s,
      /for \(const signalId of allAffectedSignalIds\) \{\s*\n\s*if \(Date\.now\(\) >= deadlineAt\)/,
      'the per-signal recompute loop must check the deadline on every iteration, not run unconditionally to completion',
    )
  })

  test('priorityQueueExhausted=true requires BOTH reconciliation and the full recompute loop to have genuinely completed -- never merely pass-1 exhaustion', () => {
    const s = src()
    assert.match(
      s,
      /priorityQueueExhausted\s*=\s*priorityQueueExhausted\s*&&\s*reconciliationCompleted\s*&&\s*allSignalsRecomputed/,
      'a false priorityQueueExhausted=true must be impossible if reconciliation or the recompute loop had to stop early due to the deadline',
    )
  })
})
