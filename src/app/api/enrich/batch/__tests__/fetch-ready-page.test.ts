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

import { fetchNextReadyPage } from '../route'

interface FixtureObs {
  id: string
  collected_at: string
  processed: boolean
  processing_error: string | null
}

/** Real, filtering mock client -- genuinely applies .eq/.is/.gte/.lt/
 * .order/.limit to the fixture array, matching the exact query shape
 * fetchNextReadyPage itself builds. Not a stub that ignores the real
 * predicates: a test using this mock would fail if the production
 * query changed in a way that broke the fresh/old split. */
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
    }
    const page = await fetchNextReadyPage(failingClient, 0, 10)
    assert.equal(page.error, 'connection reset')
    assert.equal(page.rows.length, 0)
  })
})
