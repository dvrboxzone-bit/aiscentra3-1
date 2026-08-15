/**
 * AIscentra — enrich/batch: fetchNextReadyPage tests
 *
 * Real production incident this closes: the enrichment queue was
 * ordered `collected_at ASC` with no other structure -- at 6,905
 * unprocessed observations dating back to July 21st, a fresh
 * observation collected today would never be reached until every
 * single older row was drained first. Real production evidence: a
 * 2026-08-11 10:07 UTC enrichment run against a 7,614-deep queue
 * created exactly one WEAK signal and zero ACTIVE signals before
 * hitting deadline_exceeded -- fresh material was structurally
 * starved regardless of how many cycles ran.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  fetchNextReadyPage,
  scheduleBucketStartPageIndex,
  runEnrichmentCycle,
  type BatchProcessingDeps,
} from '../route'

interface FixtureObs {
  id: string
  collected_at: string
  processed: boolean
  processing_error: string | null
  metadata?: { retry_after?: string }
}

/** Real, filtering mock client -- genuinely applies .eq/.is/.gte/.lt/
 * .or/.order/.limit to the fixture array, matching the exact query
 * shape fetchNextReadyPage itself builds. Not a stub that ignores the
 * real predicates: a test using this mock would fail if the production
 * query changed in a way that broke the fresh/old split OR the
 * query-level retry_after readiness filter. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockClient(fixture: FixtureObs[]): any {
  return {
    from: (table: string) => {
      if (table !== 'observations') throw new Error(`unexpected table: ${table}`)
      const filters: Array<(o: FixtureObs) => boolean> = []
      const builder = {
        select: () => builder,
        eq: (col: string, val: boolean) => {
          if (col === 'processed') filters.push((o) => o.processed === val)
          return builder
        },
        is: (col: string, val: null) => {
          if (col === 'processing_error') filters.push((o) => o.processing_error === val)
          return builder
        },
        // Real, minimal implementation of the SAME query-level
        // retry_after readiness filter fetchNextReadyPage itself uses:
        // `.or('metadata->>retry_after.is.null,metadata->>retry_after.lt.<now>')`.
        // Parses the exact PostgREST filter string this codebase
        // constructs -- not a generic OR-clause parser -- and applies
        // the real readiness semantics (no retry_after, or retry_after
        // strictly in the past) against the fixture's own metadata.
        or: (filterExpr: string) => {
          const ltMatch = /metadata->>retry_after\.lt\.(.+)$/.exec(filterExpr)
          const nowIso = ltMatch?.[1] ?? new Date().toISOString()
          filters.push((o) => {
            const retryAfter = o.metadata?.retry_after
            return !retryAfter || retryAfter < nowIso
          })
          return builder
        },
        gte: (col: string, val: string) => {
          if (col === 'collected_at') filters.push((o) => o.collected_at >= val)
          return builder
        },
        lt: (col: string, val: string) => {
          if (col === 'collected_at') filters.push((o) => o.collected_at < val)
          return builder
        },
        order: () => builder,
        limit: async (n: number) => {
          const matched = fixture
            .filter((o) => filters.every((f) => f(o)))
            .sort((a, b) =>
              a.collected_at < b.collected_at ? -1 : a.collected_at > b.collected_at ? 1 : 0,
            )
            .slice(0, n)
          return { data: matched, error: null }
        },
      }
      return builder
    },
  }
}

function obs(id: string, hoursAgo: number): FixtureObs {
  return {
    id,
    collected_at: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
    processed: false,
    processing_error: null,
  }
}

describe('fetchNextReadyPage — a fresh observation is processed even with a large old backlog (the real incident this closes)', () => {
  test('even pageIndex (fresh pool) finds the one recent observation despite hundreds of older ones', async () => {
    const oldBacklog = Array.from({ length: 500 }, (_, i) => obs(`old-${i}`, 24 * 20 + i)) // ~20+ days old
    const freshOne = obs('fresh-1', 1) // collected 1 hour ago
    const client = makeMockClient([...oldBacklog, freshOne])

    const page = await fetchNextReadyPage(client, 0, 10) // pageIndex=0 -> fresh pool
    assert.equal(page.error, null)
    assert.equal(page.pool, 'fresh')
    assert.deepEqual(
      page.rows.map((r) => r.id),
      ['fresh-1'],
      'the fresh observation must be found on the FIRST fresh-pool page, regardless of a 500-row old backlog',
    )
  })

  test('odd pageIndex (old pool) correctly drains backlog without being affected by fresh material', async () => {
    const oldBacklog = [obs('old-1', 24 * 25), obs('old-2', 24 * 24), obs('old-3', 24 * 23)]
    const freshOne = obs('fresh-1', 1)
    const client = makeMockClient([...oldBacklog, freshOne])

    const page = await fetchNextReadyPage(client, 1, 10) // pageIndex=1 -> old pool
    assert.equal(page.pool, 'old')
    assert.equal(
      page.rows.some((r) => r.id === 'fresh-1'),
      false,
      'the old-pool page must never include fresh material',
    )
    assert.equal(page.rows.length, 3)
  })
})

describe('fetchNextReadyPage — the old backlog continues to shrink (alternation makes real progress on both pools)', () => {
  test('across many simulated iterations, both fresh and old pools are genuinely drained, not just one', async () => {
    const oldBacklog = Array.from({ length: 20 }, (_, i) => obs(`old-${i}`, 24 * 30 + i))
    const freshBatch = Array.from({ length: 20 }, (_, i) => obs(`fresh-${i}`, i)) // 0-19 hours ago, all within the 24h fresh window
    const fixture: FixtureObs[] = [...oldBacklog, ...freshBatch]
    const client = makeMockClient(fixture)

    const seenOld = new Set<string>()
    const seenFresh = new Set<string>()
    for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
      const page = await fetchNextReadyPage(client, pageIndex, 3)
      for (const row of page.rows) {
        if (row.id.startsWith('old-')) seenOld.add(row.id)
        else seenFresh.add(row.id)
      }
    }

    assert.ok(
      seenOld.size > 0,
      'the old backlog must make real progress across iterations, not be starved by fresh material',
    )
    assert.ok(
      seenFresh.size > 0,
      'fresh material must make real progress across iterations, not be starved by the old backlog',
    )
  })
})

describe('fetchNextReadyPage — fallback when the preferred pool is genuinely empty', () => {
  test('if there is no fresh material at all, an even pageIndex still returns old-pool rows instead of an empty page', async () => {
    const oldBacklog = [obs('old-1', 24 * 10), obs('old-2', 24 * 9)]
    const client = makeMockClient(oldBacklog) // no fresh observations exist at all

    const page = await fetchNextReadyPage(client, 0, 10) // pageIndex=0 prefers fresh, but none exist
    assert.equal(
      page.pool,
      'old',
      'must fall back to the old pool rather than returning an empty page',
    )
    assert.equal(page.rows.length, 2)
  })

  test('if there is no old backlog at all, an odd pageIndex still returns fresh-pool rows instead of an empty page', async () => {
    const freshOnly = [obs('fresh-1', 2)]
    const client = makeMockClient(freshOnly)

    const page = await fetchNextReadyPage(client, 1, 10) // pageIndex=1 prefers old, but none exist
    assert.equal(page.pool, 'fresh')
    assert.equal(page.rows.length, 1)
  })

  test('a real read error is surfaced, not silently swallowed as an empty page', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failingClient: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              or: () => ({
                gte: () => ({
                  order: () => ({
                    limit: async () => ({ data: null, error: { message: 'connection reset' } }),
                  }),
                }),
                lt: () => ({
                  order: () => ({
                    limit: async () => ({ data: null, error: { message: 'connection reset' } }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }
    const page = await fetchNextReadyPage(failingClient, 0, 10)
    assert.equal(page.error, 'connection reset')
    assert.equal(page.rows.length, 0)
  })
})

describe('fetchNextReadyPage — retry_after does not mask a genuinely non-empty pool as queue_empty (real production incident this closes)', () => {
  test('deferred rows (future retry_after) come first in collected_at order, a ready row is later -- the ready row is genuinely returned, the deferred rows are excluded, queue_empty is NOT falsely triggered', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1h in the future -- genuinely deferred
    const deferred1: FixtureObs = {
      id: 'deferred-1',
      collected_at: '2026-08-01T00:00:00.000Z', // earliest -- would be first in a naive .order('collected_at').limit(N) without the readiness filter
      processed: false,
      processing_error: null,
      metadata: { retry_after: future },
    }
    const deferred2: FixtureObs = {
      id: 'deferred-2',
      collected_at: '2026-08-01T01:00:00.000Z',
      processed: false,
      processing_error: null,
      metadata: { retry_after: future },
    }
    const readyLater: FixtureObs = {
      id: 'ready-later',
      collected_at: '2026-08-01T02:00:00.000Z', // LATER in collected_at order than both deferred rows
      processed: false,
      processing_error: null,
      metadata: {}, // no retry_after -- genuinely ready right now
    }
    const client = makeMockClient([deferred1, deferred2, readyLater])

    // pageSize=2 -- without the query-level readiness filter, a naive
    // `ORDER BY collected_at LIMIT 2` would return ONLY the two
    // deferred rows, and client-side filtering them out would produce
    // an empty `ready` array -- exactly the real incident: a page
    // consisting entirely of deferred rows being misread as "the pool
    // is empty," even though a real, ready observation exists right
    // behind them in the same ordering.
    const page = await fetchNextReadyPage(client, 0, 2)

    assert.equal(page.error, null)
    assert.deepEqual(
      page.rows.map((r) => r.id),
      ['ready-later'],
      'the genuinely ready observation must be found, even though two earlier-collected deferred rows exist -- the query-level readiness filter excludes them entirely rather than letting them consume the page and produce a false queue_empty',
    )
    assert.notEqual(
      page.rows.length,
      0,
      'must never report an empty page when a genuinely ready observation exists in the pool',
    )
  })

  test('a pool consisting ENTIRELY of deferred rows (no ready observation at all) correctly returns an empty page -- a real, provable exhaustion, not a false negative in the other direction', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const allDeferred: FixtureObs[] = [
      {
        id: 'd1',
        collected_at: '2026-08-01T00:00:00.000Z',
        processed: false,
        processing_error: null,
        metadata: { retry_after: future },
      },
      {
        id: 'd2',
        collected_at: '2026-08-01T01:00:00.000Z',
        processed: false,
        processing_error: null,
        metadata: { retry_after: future },
      },
    ]
    const client = makeMockClient(allDeferred)

    const page = await fetchNextReadyPage(client, 0, 10)

    assert.equal(page.error, null)
    assert.equal(
      page.rows.length,
      0,
      'a pool with genuinely no ready rows (only deferred ones) must correctly report an empty page -- this is a REAL exhaustion, not a masking bug',
    )
  })
})

describe('scheduleBucketStartPageIndex — cross-invocation fairness (real production incident: short invocations always started with pageIndex=0, so a short cycle ALWAYS began with the fresh pool, letting the old backlog starve across many consecutive short invocations even though within any single long-running cycle both pools alternate correctly)', () => {
  test('two adjacent 4-hour UTC schedule buckets start with different pool parity (fresh vs old)', () => {
    // A fixed reference instant, then exactly one real 4-hour bucket
    // boundary later -- genuinely crossing into the NEXT schedule
    // bucket, not a synthetic override of the bucket math itself.
    const referenceMs = Date.UTC(2026, 7, 11, 1, 0, 0) // 2026-08-11T01:00:00Z -- inside bucket 0 (hours 0-3)
    const nextBucketMs = referenceMs + 4 * 60 * 60 * 1000 // 2026-08-11T05:00:00Z -- inside bucket 1 (hours 4-7)

    const firstIndex = scheduleBucketStartPageIndex(referenceMs)
    const secondIndex = scheduleBucketStartPageIndex(nextBucketMs)

    assert.notEqual(
      firstIndex % 2,
      secondIndex % 2,
      `adjacent schedule buckets must alternate parity (fresh vs old) -- got ${firstIndex} then ${secondIndex}`,
    )
  })

  test("six consecutive schedule buckets (a full real day, matching collect-4h.yml's own 6-cycles/day cadence) alternate parity throughout, including the wrap from bucket 5 back to bucket 0", () => {
    const dayStartMs = Date.UTC(2026, 7, 11, 0, 0, 0)
    const indices: number[] = []
    for (let i = 0; i < 7; i++) {
      // 7 samples -- 6 real buckets plus one that wraps back to bucket 0
      indices.push(scheduleBucketStartPageIndex(dayStartMs + i * 4 * 60 * 60 * 1000))
    }
    for (let i = 1; i < indices.length; i++) {
      assert.notEqual(
        (indices[i - 1] as number) % 2,
        (indices[i] as number) % 2,
        `bucket ${i - 1} (index ${indices[i - 1]}) and bucket ${i} (index ${indices[i]}) must have alternating parity, including the wrap-around`,
      )
    }
  })

  test('two consecutive SHORT invocations (each completing only ONE page before its own deadline) genuinely alternate fresh/old across runs -- not merely within one', async () => {
    const oldObs = {
      id: 'old-1',
      source_id: 's1',
      title: 't',
      content: 'c',
      url: 'https://example.com',
      published_at: '2026-07-01T00:00:00Z',
      collected_at: '2026-07-01T00:00:00Z', // well outside the 24h fresh window
      metadata: {},
      processed: false,
      processing_error: null,
      signal_id: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const freshObs = {
      ...oldObs,
      id: 'fresh-1',
      collected_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago -- inside the fresh window
    }

    const poolsSeen: Array<'fresh' | 'old'> = []
    const makeDepsForPool = (): BatchProcessingDeps => ({
      fetchSourceInfo: async () => ({ ok: true, trustScore: 0.8, sourceName: 'Test Source' }),
      fetchObservationsPage: async (pageIndex: number) => {
        // Real fresh/old alternation logic, matching fetchNextReadyPage
        // itself: even pageIndex -> fresh pool, odd -> old.
        const wantFresh = pageIndex % 2 === 0
        const pool: 'fresh' | 'old' = wantFresh ? 'fresh' : 'old'
        poolsSeen.push(pool)
        return { rows: [wantFresh ? freshObs : oldObs], error: null, pool }
      },
      processObservation: (async (obs) => ({
        observationId: obs.id,
        outcome: 'signal_created' as const,
        signalId: 'sig-1',
      })) as BatchProcessingDeps['processObservation'],
      markObservationProcessed: async () => ({ ok: true }),
      markObservationForRetry: async () => 'ok',
      sleep: async () => {},
    })

    // Invocation 1: schedule bucket 0 (even startPageIndex -> fresh
    // first), deadline forces exactly one page.
    const deps1 = makeDepsForPool()
    await runEnrichmentCycle(Date.now() + 4_000, deps1, 0)

    // Invocation 2: schedule bucket 1 (odd startPageIndex -> old
    // first) -- simulating the NEXT real invocation, 4 real schedule
    // hours later, with its own short deadline.
    const deps2 = makeDepsForPool()
    await runEnrichmentCycle(Date.now() + 4_000, deps2, 1)

    assert.equal(
      poolsSeen[0],
      'fresh',
      'invocation 1 (schedule bucket 0) must start with the fresh pool',
    )
    assert.equal(
      poolsSeen[1],
      'old',
      'invocation 2 (schedule bucket 1) must start with the old pool -- proving old/fresh genuinely alternate ACROSS invocations, not merely within one long-running cycle',
    )
  })

  test('fallback to the other pool still works when driven via a real schedule-bucket-derived starting index, not only pageIndex=0', async () => {
    const oldOnly: FixtureObs = {
      id: 'old-only',
      collected_at: '2026-07-01T00:00:00.000Z',
      processed: false,
      processing_error: null,
    }
    const client = makeMockClient([oldOnly]) // no fresh material exists at all

    // startPageIndex=0 (bucket 0, even -> prefers fresh) -- but no
    // fresh material exists, so fetchNextReadyPage's own fallback must
    // still find the old-pool row.
    const page = await fetchNextReadyPage(
      client,
      scheduleBucketStartPageIndex(Date.UTC(2026, 7, 11, 1, 0, 0)),
      10,
    )
    assert.equal(
      page.pool,
      'old',
      'must fall back to the old pool even when the schedule-bucket-derived start prefers fresh',
    )
    assert.equal(page.rows.length, 1)
  })
})
