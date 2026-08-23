/**
 * AIscentra — TPD budget tests
 *
 * The mock below emulates the ATOMIC behaviour of the SQL function
 * consume_ai_token_budget: it holds the running total itself and does
 * the check-and-increment as one indivisible step, exactly as the
 * advisory-lock-protected function does in PostgreSQL. That is what
 * makes the concurrency test meaningful -- if the production code ever
 * regressed to a separate read-then-write, it would not be able to use
 * this single-call interface at all.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  consumeTokenBudget,
  getTpdLimit,
  getSignalEngineReserve,
  type BudgetRpcClient,
} from '../token-budget'

const MODEL = 'llama-3.3-70b-versatile'

function makeLedger(opts: { failWith?: string; startUsed?: number } = {}): {
  client: BudgetRpcClient
  calls: number
  usedNow: () => number
} {
  let used = opts.startUsed ?? 0
  let calls = 0

  const client: BudgetRpcClient = {
    rpc: async (_fn, args) => {
      calls++
      if (opts.failWith) return { data: null, error: { message: opts.failWith } }

      const limit = args['p_limit'] as number
      const reserve = args['p_reserve_ratio'] as number
      const tokens = args['p_tokens'] as number
      const consumer = args['p_consumer'] as string

      // Mirrors the SQL function exactly: limit - floor(limit *
      // reserve), NOT floor(limit * (1 - reserve)) -- the latter
      // yields 9999 for (100000, 0.9) in IEEE754 arithmetic.
      const ceiling = consumer === 'signal_engine' ? limit : limit - Math.floor(limit * reserve)

      // Atomic: decide and commit together, no await in between.
      if (used + tokens > ceiling) {
        return {
          data: [{ allowed: false, used_tokens: used, ceiling_tokens: ceiling }],
          error: null,
        }
      }
      const observed = used
      used += tokens
      return {
        data: [{ allowed: true, used_tokens: observed, ceiling_tokens: ceiling }],
        error: null,
      }
    },
  }

  return {
    client,
    get calls() {
      return calls
    },
    usedNow: () => used,
  } as { client: BudgetRpcClient; calls: number; usedNow: () => number }
}

describe('token budget configuration', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env['GROQ_TPD_LIMIT']
    delete process.env['SIGNAL_ENGINE_TPD_RESERVE']
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  test('defaults to Groq free-tier 200,000 TPD when unset', () => {
    assert.equal(getTpdLimit(), 200_000)
  })

  test('limit is configurable, not hardcoded', () => {
    process.env['GROQ_TPD_LIMIT'] = '250000'
    assert.equal(getTpdLimit(), 250_000)
  })

  test('ignores a non-numeric or non-positive limit rather than trusting it', () => {
    process.env['GROQ_TPD_LIMIT'] = 'not-a-number'
    assert.equal(getTpdLimit(), 200_000)
    process.env['GROQ_TPD_LIMIT'] = '0'
    assert.equal(getTpdLimit(), 200_000)
  })

  test('Signal Engine reserve defaults to the owner-mandated 90% minimum', () => {
    assert.equal(getSignalEngineReserve(), 0.9)
  })

  test('reserve is clamped so it can never drop below a majority share', () => {
    process.env['SIGNAL_ENGINE_TPD_RESERVE'] = '0.1'
    assert.equal(getSignalEngineReserve(), 0.5)
  })

  test('reserve is clamped below 1.0 so the Assistant is never mathematically excluded', () => {
    process.env['SIGNAL_ENGINE_TPD_RESERVE'] = '1.0'
    assert.equal(getSignalEngineReserve(), 0.99)
  })
})

describe('consumeTokenBudget — Signal Engine priority', () => {
  test('Signal Engine may spend into the reserved 90%, well past the Assistant ceiling', async () => {
    // 50,000 already used: far above the Assistant's 10,000 ceiling,
    // but comfortably inside the engine's full-limit ceiling.
    const { client } = makeLedger({ startUsed: 50_000 })
    const d = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'signal_engine',
      tokens: 3_000,
    })
    assert.equal(d.allowed, true)
    assert.equal(d.ceilingTokens, 200_000)
  })

  test('Assistant is refused once the non-reserved remainder is gone, while the engine still runs', async () => {
    const { client } = makeLedger({ startUsed: 20_000 }) // == Assistant ceiling
    const assistant = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'assistant',
      tokens: 3_000,
    })
    assert.equal(assistant.allowed, false)
    assert.equal(assistant.reason, 'reserve_exhausted')
    assert.equal(assistant.ceilingTokens, 20_000)

    const engine = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'signal_engine',
      tokens: 3_000,
    })
    assert.equal(engine.allowed, true, 'engine must keep working after the Assistant is cut off')
  })

  test('Assistant is allowed while headroom above the reserve remains', async () => {
    const { client } = makeLedger({ startUsed: 2_000 })
    const d = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'assistant',
      tokens: 3_000,
    })
    assert.equal(d.allowed, true)
  })

  test('Signal Engine is refused only at the true daily limit', async () => {
    const { client } = makeLedger({ startUsed: 199_000 })
    const d = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'signal_engine',
      tokens: 3_000,
    })
    assert.equal(d.allowed, false)
  })
})

describe('consumeTokenBudget — concurrency', () => {
  test('concurrent Assistant requests cannot both consume the same headroom', async () => {
    // Room for exactly ONE more 3,000-token Assistant call
    // (ceiling 20,000, used 17,000 -> 17,000+3,000 == 20,000 fits exactly).
    const ledger = makeLedger({ startUsed: 17_000 })
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        consumeTokenBudget(ledger.client, {
          model: MODEL,
          consumer: 'assistant',
          tokens: 3_000,
        }),
      ),
    )
    const allowed = results.filter((r) => r.allowed).length
    assert.equal(allowed, 1, `exactly one of 5 concurrent requests may pass, got ${allowed}`)
    assert.ok(
      ledger.usedNow() <= 20_000,
      `ledger must never exceed the ceiling, got ${ledger.usedNow()}`,
    )
  })

  test('a burst that fits entirely is fully admitted', async () => {
    const ledger = makeLedger({ startUsed: 0 })
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        consumeTokenBudget(ledger.client, { model: MODEL, consumer: 'assistant', tokens: 1_000 }),
      ),
    )
    assert.equal(results.filter((r) => r.allowed).length, 3)
    assert.equal(ledger.usedNow(), 3_000)
  })
})

describe('consumeTokenBudget — unavailable budget state', () => {
  test('Assistant FAILS CLOSED when budget state cannot be determined', async () => {
    const { client } = makeLedger({ failWith: 'connection reset' })
    const d = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'assistant',
      tokens: 3_000,
    })
    assert.equal(d.allowed, false, 'Assistant must be blocked, not let through blind')
    assert.equal(d.reason, 'budget_unavailable')
  })

  test('Signal Engine FAILS OPEN when budget state cannot be determined', async () => {
    const { client } = makeLedger({ failWith: 'connection reset' })
    const d = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'signal_engine',
      tokens: 3_000,
    })
    assert.equal(d.allowed, true, 'a bookkeeping outage must not halt the core product')
  })

  test('an empty RPC response is treated as unavailable, not as permission', async () => {
    const client: BudgetRpcClient = { rpc: async () => ({ data: [], error: null }) }
    const d = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'assistant',
      tokens: 100,
    })
    assert.equal(d.allowed, false)
    assert.equal(d.reason, 'budget_unavailable')
  })

  test('a thrown exception is caught and resolved by the same asymmetric rule', async () => {
    const client: BudgetRpcClient = {
      rpc: async () => {
        throw new Error('network down')
      },
    }
    const assistant = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'assistant',
      tokens: 100,
    })
    const engine = await consumeTokenBudget(client, {
      model: MODEL,
      consumer: 'signal_engine',
      tokens: 100,
    })
    assert.equal(assistant.allowed, false)
    assert.equal(engine.allowed, true)
  })
})
