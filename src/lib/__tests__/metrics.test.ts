/**
 * AIscentra — pipeline cycle metrics tests
 *
 * Real gap this closes: ingestion/processing/latency/failure data
 * previously existed only in ephemeral cron HTTP response bodies,
 * never persisted or queryable after the fact.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { recordCycleMetrics, computePercentile, type MetricsRpcClient } from '../metrics'

function makeMockClient(config: { insertError?: string } = {}): {
  client: MetricsRpcClient
  inserted: Array<Record<string, unknown>>
} {
  const inserted: Array<Record<string, unknown>> = []
  const client: MetricsRpcClient = {
    rpc: async () => ({ data: null, error: null }),
    from: (_table: string) => ({
      insert: async (values: Record<string, unknown>) => {
        if (config.insertError) return { data: null, error: { message: config.insertError } }
        inserted.push(values)
        return { data: null, error: null }
      },
    }),
  }
  return { client, inserted }
}

describe('recordCycleMetrics', () => {
  test('records duration_ms as the real elapsed time, not a re-derived guess', async () => {
    const { client, inserted } = makeMockClient()
    await recordCycleMetrics(client, {
      cycleType: 'enrichment',
      startedAt: 1000,
      completedAt: 6500,
      itemsAttempted: 5,
      itemsSucceeded: 3,
      itemsFailed: 2,
      failureBreakdown: { rate_limit: 1, deadline_exceeded: 1 },
    })

    assert.equal(inserted.length, 1)
    assert.equal(inserted[0]?.['duration_ms'], 5500)
    assert.equal(inserted[0]?.['cycle_type'], 'enrichment')
    assert.equal(inserted[0]?.['items_succeeded'], 3)
  })

  test('failure_breakdown is passed through as structured data, not stringified', async () => {
    const { client, inserted } = makeMockClient()
    await recordCycleMetrics(client, {
      cycleType: 'collection',
      startedAt: 0,
      completedAt: 100,
      itemsAttempted: 9,
      itemsSucceeded: 8,
      itemsFailed: 1,
      failureBreakdown: { http_503: 1 },
    })

    assert.deepEqual(inserted[0]?.['failure_breakdown'], { http_503: 1 })
  })

  test('stoppedReason defaults to null when not provided', async () => {
    const { client, inserted } = makeMockClient()
    await recordCycleMetrics(client, {
      cycleType: 'collection',
      startedAt: 0,
      completedAt: 10,
      itemsAttempted: 1,
      itemsSucceeded: 1,
      itemsFailed: 0,
      failureBreakdown: {},
    })

    assert.equal(inserted[0]?.['stopped_reason'], null)
  })

  test('a database error is swallowed (non-fatal), never thrown -- metrics must not fail the pipeline they describe', async () => {
    const { client } = makeMockClient({ insertError: 'connection reset' })
    await assert.doesNotReject(
      recordCycleMetrics(client, {
        cycleType: 'enrichment',
        startedAt: 0,
        completedAt: 10,
        itemsAttempted: 1,
        itemsSucceeded: 0,
        itemsFailed: 1,
        failureBreakdown: {},
      }),
    )
  })

  test('a thrown exception from the client is also swallowed, never propagates', async () => {
    const client: MetricsRpcClient = {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        insert: async () => {
          throw new Error('network down')
        },
      }),
    }
    await assert.doesNotReject(
      recordCycleMetrics(client, {
        cycleType: 'collection',
        startedAt: 0,
        completedAt: 10,
        itemsAttempted: 1,
        itemsSucceeded: 0,
        itemsFailed: 1,
        failureBreakdown: {},
      }),
    )
  })
})

describe('computePercentile', () => {
  test('p50 of a real, unsorted sample', () => {
    assert.equal(computePercentile([500, 100, 300, 200, 400], 50), 300)
  })

  test('p95 correctly isolates the tail, not the median', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    assert.equal(computePercentile(samples, 95), 96)
  })

  test('a single sample returns that sample for any percentile', () => {
    assert.equal(computePercentile([42], 50), 42)
    assert.equal(computePercentile([42], 95), 42)
  })

  test('an empty array returns null, not NaN or a crash', () => {
    assert.equal(computePercentile([], 50), null)
  })

  test('does not mutate the input array', () => {
    const input = [5, 3, 1, 4, 2]
    computePercentile(input, 50)
    assert.deepEqual(input, [5, 3, 1, 4, 2])
  })
})

describe('recordCycleMetrics — real latency and queue metrics', () => {
  test('writes real p50/p95 computed from itemLatenciesMs, not a placeholder', async () => {
    const { client, inserted } = makeMockClient()
    await recordCycleMetrics(client, {
      cycleType: 'enrichment',
      startedAt: 0,
      completedAt: 1000,
      itemsAttempted: 5,
      itemsSucceeded: 5,
      itemsFailed: 0,
      failureBreakdown: {},
      itemLatenciesMs: [100, 200, 300, 400, 500],
    })
    assert.equal(inserted[0]?.['latency_p50_ms'], 300)
    assert.ok((inserted[0]?.['latency_p95_ms'] as number) >= 400)
  })

  test('writes queue_depth and oldest_pending_age_seconds when provided', async () => {
    const { client, inserted } = makeMockClient()
    await recordCycleMetrics(client, {
      cycleType: 'enrichment',
      startedAt: 0,
      completedAt: 100,
      itemsAttempted: 1,
      itemsSucceeded: 1,
      itemsFailed: 0,
      failureBreakdown: {},
      queueDepth: 6412,
      oldestPendingAgeSeconds: 172800,
    })
    assert.equal(inserted[0]?.['queue_depth'], 6412)
    assert.equal(inserted[0]?.['oldest_pending_age_seconds'], 172800)
  })

  test('missing latency/queue fields write null, not undefined or crash', async () => {
    const { client, inserted } = makeMockClient()
    await recordCycleMetrics(client, {
      cycleType: 'collection',
      startedAt: 0,
      completedAt: 10,
      itemsAttempted: 1,
      itemsSucceeded: 1,
      itemsFailed: 0,
      failureBreakdown: {},
    })
    assert.equal(inserted[0]?.['latency_p50_ms'], null)
    assert.equal(inserted[0]?.['queue_depth'], null)
    assert.equal(inserted[0]?.['oldest_pending_age_seconds'], null)
  })
})
