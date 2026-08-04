/**
 * AIscentra — Observatory Assistant Quota Tests
 *
 * Uses a small hand-written mock implementing QuotaFilterBuilder
 * (PromiseLike + chainable .eq(), matching Supabase's real
 * PostgrestFilterBuilder behavior) -- no real Supabase connection.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkAndIncrementQuota,
  getClientIp,
  hashIp,
  PER_IP_DAILY_LIMIT,
  GLOBAL_DAILY_LIMIT,
  type QuotaQueryClient,
  type QuotaFilterBuilder,
  type QuotaQueryResult,
} from '../quota'

interface MockConfig {
  globalRows?: Array<{ request_count: number }>
  globalError?: { message: string } | null
  perIpRows?: Array<{ request_count: number }>
  perIpError?: { message: string } | null
  upsertError?: { message: string } | null
}

function makeMockClient(config: MockConfig): {
  client: QuotaQueryClient
  upsertCalls: Array<Record<string, unknown>>
} {
  const upsertCalls: Array<Record<string, unknown>> = []

  function makeFilterBuilder(eqCallCount: number): QuotaFilterBuilder {
    const builder: QuotaFilterBuilder = {
      eq: (_col: string, _val: string) => makeFilterBuilder(eqCallCount + 1),
      then: <TResult1 = QuotaQueryResult, TResult2 = never>(
        onFulfilled?: ((value: QuotaQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> => {
        const result: QuotaQueryResult =
          eqCallCount >= 2
            ? { data: config.perIpRows ?? null, error: config.perIpError ?? null }
            : { data: config.globalRows ?? null, error: config.globalError ?? null }
        return Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined)
      },
    }
    return builder
  }

  const client: QuotaQueryClient = {
    from: () => ({
      select: () => makeFilterBuilder(0),
      upsert: (values: Record<string, unknown>) => {
        upsertCalls.push(values)
        return {
          select: async () => ({ data: null, error: config.upsertError ?? null }),
        }
      },
    }),
  }

  return { client, upsertCalls }
}

describe('checkAndIncrementQuota', () => {
  test('allows and increments when both counts are well under their limits', async () => {
    const { client, upsertCalls } = makeMockClient({
      globalRows: [{ request_count: 10 }, { request_count: 5 }],
      perIpRows: [{ request_count: 3 }],
    })

    const result = await checkAndIncrementQuota(client, '1.2.3.4')

    assert.equal(result.allowed, true)
    assert.equal(result.perIpCount, 4) // 3 + 1
    assert.equal(result.globalCount, 16) // (10+5) + 1
    assert.equal(upsertCalls.length, 1)
    assert.equal(upsertCalls[0]?.['request_count'], 4)
  })

  test('denies with reason=global when the global daily count is already at the limit', async () => {
    const globalRows = Array.from({ length: 10 }, () => ({
      request_count: GLOBAL_DAILY_LIMIT / 10,
    }))
    const { client, upsertCalls } = makeMockClient({
      globalRows,
      perIpRows: [{ request_count: 1 }], // this specific IP is nowhere near its own limit
    })

    const result = await checkAndIncrementQuota(client, '1.2.3.4')

    assert.equal(result.allowed, false)
    assert.equal(result.reason, 'global')
    assert.equal(result.globalCount, GLOBAL_DAILY_LIMIT)
    assert.equal(upsertCalls.length, 0, 'must not increment when denied')
  })

  test('denies with reason=per_ip when this IP is at its own limit, even though global has room', async () => {
    const { client, upsertCalls } = makeMockClient({
      globalRows: [{ request_count: 20 }], // well under GLOBAL_DAILY_LIMIT
      perIpRows: [{ request_count: PER_IP_DAILY_LIMIT }],
    })

    const result = await checkAndIncrementQuota(client, '5.6.7.8')

    assert.equal(result.allowed, false)
    assert.equal(result.reason, 'per_ip')
    assert.equal(result.perIpCount, PER_IP_DAILY_LIMIT)
    assert.equal(upsertCalls.length, 0, 'must not increment when denied')
  })

  test('fails open (allowed=true) when the global read errors', async () => {
    const { client } = makeMockClient({ globalError: { message: 'connection reset' } })
    const result = await checkAndIncrementQuota(client, '1.2.3.4')
    assert.equal(result.allowed, true)
  })

  test('fails open (allowed=true) when the per-IP read errors', async () => {
    const { client } = makeMockClient({
      globalRows: [{ request_count: 5 }],
      perIpError: { message: 'connection reset' },
    })
    const result = await checkAndIncrementQuota(client, '1.2.3.4')
    assert.equal(result.allowed, true)
  })

  test('fails open (allowed=true) when the increment (upsert) fails', async () => {
    const { client } = makeMockClient({
      globalRows: [{ request_count: 5 }],
      perIpRows: [{ request_count: 2 }],
      upsertError: { message: 'constraint violation' },
    })
    const result = await checkAndIncrementQuota(client, '1.2.3.4')
    assert.equal(result.allowed, true)
  })

  test('a fresh IP with no prior rows today starts at count 1, not undefined/NaN', async () => {
    const { client } = makeMockClient({ globalRows: [], perIpRows: [] })
    const result = await checkAndIncrementQuota(client, '9.9.9.9')
    assert.equal(result.allowed, true)
    assert.equal(result.perIpCount, 1)
  })
})

describe('hashIp', () => {
  test('is deterministic — the same IP always hashes to the same value', () => {
    assert.equal(hashIp('1.2.3.4'), hashIp('1.2.3.4'))
  })

  test('different IPs hash to different values', () => {
    assert.notEqual(hashIp('1.2.3.4'), hashIp('5.6.7.8'))
  })

  test('never returns the raw IP itself', () => {
    const hash = hashIp('192.168.1.1')
    assert.notEqual(hash, '192.168.1.1')
    assert.equal(hash.length, 64) // sha256 hex digest length
  })
})

describe('getClientIp', () => {
  test('uses the first entry of x-forwarded-for when present', () => {
    const req = new Request('https://example.invalid', {
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' },
    })
    assert.equal(getClientIp(req), '1.1.1.1')
  })

  test('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = new Request('https://example.invalid', {
      headers: { 'x-real-ip': '4.4.4.4' },
    })
    assert.equal(getClientIp(req), '4.4.4.4')
  })

  test('falls back to a fixed placeholder when neither header is present', () => {
    const req = new Request('https://example.invalid')
    assert.equal(getClientIp(req), 'unknown-no-proxy-header')
  })
})
