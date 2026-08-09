/**
 * AIscentra — budget gate wiring tests
 *
 * These cover the defect that the first iteration of this work had: a
 * budget module with no call sites, constraining nothing. Each test
 * here asserts the gate is actually consulted on a real code path, and
 * that a refusal genuinely prevents the Groq request rather than
 * merely being recorded.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { consumerForRole, estimateInputTokens } from '../budget-gate'

describe('consumerForRole', () => {
  test('only the assistant role is Assistant traffic', () => {
    assert.equal(consumerForRole('assistant'), 'assistant')
  })

  test('every Signal Engine role maps to signal_engine, so the core keeps priority', () => {
    for (const role of [
      'parser',
      'classifier',
      'analyzer',
      'writer',
      'brief',
      'editor',
      'strategy',
    ]) {
      assert.equal(consumerForRole(role), 'signal_engine', `${role} must be Signal Engine work`)
    }
  })
})

describe('estimateInputTokens', () => {
  test('scales with the real prompt rather than being a fixed guess', () => {
    const short = estimateInputTokens([{ role: 'user', content: 'x'.repeat(400) }])
    const long = estimateInputTokens([{ role: 'user', content: 'x'.repeat(4_000) }])
    assert.ok(long > short * 5)
  })

  test('over-estimates the real enrichment prompt rather than under-estimating it', () => {
    // Groq billed this project's real ~11,375-char enrichment prompt at
    // ~2,492 input tokens. Reserving must not come in UNDER that.
    const estimate = estimateInputTokens([{ role: 'system', content: 'x'.repeat(11_375) }])
    assert.ok(estimate >= 2_492, `estimate ${estimate} must not under-reserve vs the real 2,492`)
  })

  test('sums every message, not just the first', () => {
    const one = estimateInputTokens([{ role: 'user', content: 'x'.repeat(4_000) }])
    const two = estimateInputTokens([
      { role: 'user', content: 'x'.repeat(4_000) },
      { role: 'user', content: 'x'.repeat(4_000) },
    ])
    assert.ok(two > one * 1.9)
  })
})

describe('budget gate is wired into the real Groq call paths', () => {
  // Source-level assertions: the defect being guarded against is
  // precisely that the module exists but is called from nowhere, which
  // no behavioural test of the module itself can detect.

  test('agent.ts gates BOTH model loops (agentComplete and agentCompleteJSON)', () => {
    const src = readFileSync('src/lib/ai/agent.ts', 'utf8')
    const gateCalls = src.split('reserveBudgetForCall({').length - 1
    assert.equal(gateCalls, 2, 'both agentComplete and agentCompleteJSON must gate')
  })

  test('the gate is keyed on ref.model, so an 8b role escalating to its 70b fallback is charged to 70b', () => {
    const src = readFileSync('src/lib/ai/agent.ts', 'utf8')
    // Gating on a role's *declared primary* rather than the model of the
    // attempt in flight would let classifier/summarizer/etc. spend 70b
    // budget while appearing to be cheap 8b work.
    assert.match(src, /reserveBudgetForCall\(\{\s*model: ref\.model/)
  })

  test('the gate runs inside the fallback loop, before the provider call', () => {
    const src = readFileSync('src/lib/ai/agent.ts', 'utf8')
    const gateAt = src.indexOf('reserveBudgetForCall({')
    const callAt = src.indexOf('callProvider(ref')
    assert.ok(gateAt > -1 && callAt > -1)
    assert.ok(gateAt < callAt, 'budget must be reserved before the provider is contacted')
  })

  test('a budget refusal is never treated as "try the next model"', () => {
    const src = readFileSync('src/lib/ai/agent.ts', 'utf8')
    // Falling through to the next chain entry would spend exactly the
    // budget that was just refused.
    assert.match(src, /if \(err instanceof AITokenBudgetExceededError\) throw err/)
  })

  test("the Assistant's own direct fetch path is gated too", () => {
    const src = readFileSync('src/app/api/assistant/route.ts', 'utf8')
    const gateAt = src.indexOf('deps.reserveBudget(')
    const fetchAt = src.indexOf('deps.fetchGroq({')
    assert.ok(gateAt > -1, 'the Assistant route must consult the budget')
    assert.ok(gateAt < fetchAt, 'budget must be reserved before the Assistant contacts Groq')
  })
})

describe('automatic enrichment schedule', () => {
  const wf = (): string => readFileSync('.github/workflows/enrich-batch-hourly.yml', 'utf8')

  test('exactly 6 automatic enrichment cycles per day across GitHub and Vercel', () => {
    const cron = /- cron: '(\S+) (\S+) \* \* \*'/.exec(wf())
    assert.ok(cron, 'a cron schedule must be present')
    const githubRuns = (cron[2] ?? '').split(',').length
    // vercel.json runs /api/cron/pipeline once daily, which awaits
    // /api/enrich/batch and is therefore a 6th enrichment cycle.
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>
    }
    const vercelRuns = (vercel.crons ?? []).filter((c) => c.path === '/api/cron/pipeline').length
    assert.equal(
      githubRuns + vercelRuns,
      6,
      `expected exactly 6 cycles/day, got ${githubRuns} (GitHub) + ${vercelRuns} (Vercel)`,
    )
  })

  test('no GitHub run can overlap the Vercel pipeline hour', () => {
    const cron = /- cron: '(\S+) (\S+) \* \* \*'/.exec(wf())
    const githubHours = (cron?.[2] ?? '').split(',')
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>
    }
    for (const c of vercel.crons ?? []) {
      const vercelHour = c.schedule.split(' ')[1]
      assert.ok(
        !githubHours.includes(vercelHour ?? ''),
        `GitHub hour ${vercelHour} collides with the Vercel cron -- two enrichment loops would share the TPD budget at once`,
      )
    }
  })

  test('concurrent runs are serialized, and in-flight runs are not cancelled', () => {
    const src = wf()
    assert.match(src, /concurrency:/)
    assert.match(src, /cancel-in-progress:\s*false/)
  })

  test('manual dispatch is retained and shares the same concurrency group', () => {
    const src = wf()
    assert.match(src, /workflow_dispatch:/)
    // One top-level concurrency block covers every trigger, so a manual
    // dispatch cannot run alongside a scheduled one.
    assert.equal(src.split('concurrency:').length - 1, 1)
  })

  test('the schedule is no longer hourly', () => {
    const src = wf()
    assert.ok(!/- cron: '0 \* \* \* \*'/.test(src), 'hourly overspends TPD by ~3x')
  })
})
