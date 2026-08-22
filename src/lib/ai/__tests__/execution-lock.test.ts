/**
 * AIscentra — per-attempt budget reservation, execution lock, ledger cleanup
 *
 * Guards the defect this round fixed: the gate previously ran ONCE per
 * model, outside withRetry, while withRetry issues up to MAX_RETRIES+1
 * real Groq calls. Four actual provider calls consumed one reservation
 * -- a 4x under-count of the budget they spent.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { __setBudgetReserverForTests, AITokenBudgetExceededError } from '../budget-gate'
import {
  acquireEnrichmentLock,
  releaseEnrichmentLock,
  pruneTokenLedger,
  ENRICHMENT_LOCK,
  type LockRpcClient,
} from '../execution-lock'

describe('budget is reserved per PROVIDER ATTEMPT, not per model', () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env['GROQ_API_KEY']
  const originalCfToken = process.env['CLOUDFLARE_API_TOKEN']
  const originalCfAccount = process.env['CLOUDFLARE_ACCOUNT_ID']
  let restore: (() => void) | undefined

  beforeEach(() => {
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    // REAL ARCHITECTURE CHANGE (independent audit): the real fallback
    // chain now includes a third provider (Cloudflare). Without a real
    // (even if fake) CLOUDFLARE_API_TOKEN/ACCOUNT_ID, callProvider()
    // genuinely fails FAST for that one attempt (missing-config error,
    // before any fetch) rather than retrying like the other two real
    // 503s -- correct behavior, but it breaks this describe block's
    // own 1:1 calls==reservations invariant unless all three providers
    // are given the SAME uniform treatment.
    process.env['CLOUDFLARE_API_TOKEN'] = 'test-key-not-real'
    process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-not-real'
  })
  afterEach(() => {
    restore?.()
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env['GROQ_API_KEY']
    else process.env['GROQ_API_KEY'] = originalKey
    if (originalCfToken === undefined) delete process.env['CLOUDFLARE_API_TOKEN']
    else process.env['CLOUDFLARE_API_TOKEN'] = originalCfToken
    if (originalCfAccount === undefined) delete process.env['CLOUDFLARE_ACCOUNT_ID']
    else process.env['CLOUDFLARE_ACCOUNT_ID'] = originalCfAccount
  })

  test('four provider attempts produce four reservations', async () => {
    const reservations: string[] = []
    restore = __setBudgetReserverForTests(async (p) => {
      reservations.push(p.model)
    })

    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      // 503 is retryable, so withRetry keeps going: 1 initial attempt +
      // MAX_RETRIES(3) = 4 real provider calls for this one model.
      return new Response('server error', { status: 503 })
    }) as typeof fetch

    const { agentComplete } = await import('../agent')
    await assert.rejects(
      agentComplete('parser', [{ role: 'user', content: 'hi' }], {}, Date.now() + 120_000),
    )

    // REAL ARCHITECTURE CHANGE: the real fallback chain now has 3
    // models (was 2), each retrying MAX_RETRIES(3)+1=4 times on a
    // uniformly-retryable 503 -- 3*4=12, not the old 2*4=8.
    assert.ok(calls >= 12, `expected >=12 provider calls, got ${calls}`)
    assert.equal(
      reservations.length,
      calls,
      `every provider call must have its own reservation: ${calls} calls vs ${reservations.length} reservations`,
    )
  })

  test('a gate refusal before a retry prevents the next Groq call', async () => {
    let reserveCount = 0
    restore = __setBudgetReserverForTests(async () => {
      reserveCount++
      // Allow the first attempt, refuse from the second onward.
      if (reserveCount > 1) {
        throw new AITokenBudgetExceededError('refused', 'm', 'signal_engine', {
          allowed: false,
          usedTokens: 0,
          ceilingTokens: 0,
        })
      }
    })

    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response('server error', { status: 503 })
    }) as typeof fetch

    const { agentComplete } = await import('../agent')
    await assert.rejects(
      agentComplete('parser', [{ role: 'user', content: 'hi' }], {}, Date.now() + 120_000),
      (err: unknown) => err instanceof AITokenBudgetExceededError,
    )

    assert.equal(calls, 1, `Groq must not be called after the gate refused, got ${calls} calls`)
  })

  test('retry and fallback are charged to the model actually being called', async () => {
    const reservedModels: string[] = []
    restore = __setBudgetReserverForTests(async (p) => {
      reservedModels.push(p.model)
    })

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { model: string }
      // Non-retryable for the primary, so the chain falls back; the
      // fallback then succeeds.
      if (
        reservedModels.filter((m) => m === body.model).length <= 1 &&
        reservedModels.length === 1
      ) {
        return new Response('bad request', { status: 400 })
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 5 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const { agentComplete } = await import('../agent')
    await agentComplete('classifier', [{ role: 'user', content: 'hi' }], {}, Date.now() + 120_000)

    // classifier's chain is [MINI primary, PRIMARY fallback, CLOUDFLARE
    // fallback]. Reserving on the role's declared primary would charge
    // the escalation to MINI; keying on ref.model charges it to the
    // PRIMARY (120b) budget it actually spends.
    assert.ok(reservedModels.length >= 2, 'both chain entries must reserve')
    assert.ok(
      new Set(reservedModels).size >= 2,
      `reservations must name distinct models, got ${JSON.stringify(reservedModels)}`,
    )
    assert.ok(
      reservedModels.some((m) => m.includes('120b')),
      'the 120b (primary) fallback must be charged to the 120b budget',
    )
  })
})

describe('cross-platform execution lock', () => {
  function makeLockClient(opts: { acquire?: unknown; fail?: string } = {}): {
    client: LockRpcClient
    calls: Array<{ fn: string; args: Record<string, unknown> }>
  } {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const client: LockRpcClient = {
      rpc: async (fn, args) => {
        calls.push({ fn, args })
        if (opts.fail) return { data: null, error: { message: opts.fail } }
        if (fn === 'acquire_execution_lock') return { data: opts.acquire ?? true, error: null }
        if (fn === 'prune_ai_token_usage') return { data: 3, error: null }
        return { data: true, error: null }
      },
    }
    return { client, calls }
  }

  test('acquires the lock when free', async () => {
    const { client, calls } = makeLockClient({ acquire: true })
    assert.equal(await acquireEnrichmentLock(client, 'run-1'), true)
    assert.equal(calls[0]?.fn, 'acquire_execution_lock')
    assert.equal(calls[0]?.args['p_lock_name'], ENRICHMENT_LOCK)
  })

  test('returns false (does not throw) when another run holds it', async () => {
    const { client } = makeLockClient({ acquire: false })
    assert.equal(await acquireEnrichmentLock(client, 'run-2'), false)
  })

  test('FAILS CLOSED on RPC error — an unprovable lock must not run a cycle', async () => {
    const { client } = makeLockClient({ fail: 'connection reset' })
    assert.equal(
      await acquireEnrichmentLock(client, 'run-3'),
      false,
      'proceeding blind is exactly the overlap the lock exists to prevent',
    )
  })

  test('release never throws, so a failed release cannot fail a good run', async () => {
    const { client } = makeLockClient({ fail: 'connection reset' })
    await releaseEnrichmentLock(client, 'run-4')
  })
})

describe('ledger cleanup is actually invoked', () => {
  test('pruneTokenLedger calls the real prune function and reports rows removed', async () => {
    const calls: string[] = []
    const client: LockRpcClient = {
      rpc: async (fn) => {
        calls.push(fn)
        return { data: 3, error: null }
      },
    }
    assert.equal(await pruneTokenLedger(client), 3)
    assert.deepEqual(calls, ['prune_ai_token_usage'])
  })

  test('prune failure is non-fatal — maintenance must never block enrichment', async () => {
    const client: LockRpcClient = {
      rpc: async () => ({ data: null, error: { message: 'boom' } }),
    }
    assert.equal(await pruneTokenLedger(client), 0)
  })

  test('the enrichment route actually calls cleanup — not just defines it', () => {
    // The previous iteration created prune_ai_token_usage() and never
    // called it from anywhere, so the ledger still grew unbounded.
    const src = readFileSync('src/app/api/enrich/batch/route.ts', 'utf8')
    assert.match(src, /pruneTokenLedger\(/, 'cleanup must be invoked on a real code path')
  })
})

describe('the enrichment route takes the shared lock', () => {
  const src = (): string => readFileSync('src/app/api/enrich/batch/route.ts', 'utf8')

  test('acquires the lock before doing any work', () => {
    const s = src()
    const lockAt = s.indexOf('acquireEnrichmentLock(')
    // REAL REFACTOR (independent review): the POST handler's own
    // inline processing loop was extracted into a separate, testable
    // runEnrichmentCycle function (defined ABOVE POST in the file, so
    // its own body -- including the literal string
    // "processBatchOfObservations(ready" -- now appears earlier in the
    // file than POST's own acquireEnrichmentLock call, even though the
    // REAL runtime order is unchanged: POST still acquires the lock
    // first, then calls runEnrichmentCycle, which is what actually
    // invokes processBatchOfObservations. This check now looks for
    // POST's own call site (runEnrichmentCycle(deadlineAt, deps)),
    // which genuinely still appears after acquireEnrichmentLock in the
    // file, matching the real invariant this test exists to guard.
    const processAt = s.indexOf('runEnrichmentCycle(deadlineAt, deps)')
    assert.ok(lockAt > -1 && processAt > -1 && lockAt < processAt, 'lock must precede processing')
  })

  test('a losing run returns early without processing', () => {
    assert.match(src(), /enrichment_already_running/)
  })

  test('the lock is released in a finally block', () => {
    assert.match(src(), /finally \{[\s\S]*releaseEnrichmentLock\(/)
  })
})
