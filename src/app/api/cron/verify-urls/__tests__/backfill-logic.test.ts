/**
 * AIscentra — /api/cron/verify-urls backfill logic tests
 *
 * Real gap this closes: the earlier version processed at most 30
 * observations/invocation with no deterministic ordering, no priority
 * for observations gating a currently-ACTIVE signal, and wrote
 * verification results without counting write failures separately
 * from genuine success. These tests exercise drainOnePage directly
 * with an injected mock Supabase-shaped client (the same dependency-
 * injection convention used throughout this codebase), covering what
 * the PostgreSQL integration test (pg-integration-test.sh TEST 18)
 * does not: the TypeScript-level accounting logic itself.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { drainOnePage } from '../route'

// Real fetch/DNS are not exercised here -- verifyUrlReachable itself
// is unit-tested exhaustively in source-links.test.ts. This mock
// client controls only the DATABASE layer, so these tests isolate the
// accounting/pagination logic specifically.
function makeMockClient(config: {
  observations: Array<{ id: string; url: string; signal_id: string | null }>
  activeSignalIds?: string[]
  writeErrorForIds?: Set<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): { client: any; written: Array<{ id: string; url_verified_ok: boolean }> } {
  const written: Array<{ id: string; url_verified_ok: boolean }> = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from: (table: string) => {
      if (table === 'signals') {
        return {
          select: () => ({
            eq: async () => ({
              data: (config.activeSignalIds ?? []).map((id) => ({ id })),
              error: null,
            }),
          }),
        }
      }
      // 'observations'
      return {
        select: () => ({
          is: () => {
            const builder = {
              gt: (_col: string, cursor: string) => {
                const filtered = config.observations.filter((o) => o.id > cursor)
                return {
                  in: (_col2: string, ids: string[]) => ({
                    order: () => ({
                      limit: async (n: number) => ({
                        data: filtered
                          .filter((o) => o.signal_id && ids.includes(o.signal_id))
                          .slice(0, n),
                        error: null,
                      }),
                    }),
                  }),
                  order: () => ({
                    limit: async (n: number) => ({ data: filtered.slice(0, n), error: null }),
                  }),
                }
              },
              in: (_col2: string, ids: string[]) => ({
                order: () => ({
                  limit: async (n: number) => ({
                    data: config.observations
                      .filter((o) => o.signal_id && ids.includes(o.signal_id))
                      .slice(0, n),
                    error: null,
                  }),
                }),
              }),
              order: () => ({
                limit: async (n: number) => ({
                  data: config.observations.slice(0, n),
                  error: null,
                }),
              }),
            }
            return builder
          },
        }),
        update: (values: { url_verified_ok: boolean; url_verified_at: string }) => ({
          eq: async (_col: string, id: string) => {
            if (config.writeErrorForIds?.has(id)) {
              return { error: { message: 'simulated write failure' } }
            }
            written.push({ id, url_verified_ok: values.url_verified_ok })
            return { error: null }
          },
        }),
      }
    },
  }

  return { client, written }
}

describe('drainOnePage — write errors are never counted as success (real security/correctness fix)', () => {
  test('a write failure is excluded from processed/ok/failed counts entirely', async () => {
    const { client } = makeMockClient({
      observations: [
        { id: 'obs-1', url: 'https://example.com/a', signal_id: null },
        { id: 'obs-2', url: 'https://example.com/b', signal_id: null },
      ],
      writeErrorForIds: new Set(['obs-1']),
    })

    const { result } = await drainOnePage(client, false, null)

    // obs-1's write fails -> must not be counted as processed/ok/failed
    // at all (a write failure is not the same thing as a URL being
    // reachable or not -- nothing about that row's real state changed).
    assert.equal(result.writeFailures, 1)
    assert.equal(result.processed, 1, 'only obs-2 (the successful write) is counted as processed')
  })

  test('a page where EVERY write fails reports zero processed, not a false success', async () => {
    const { client } = makeMockClient({
      observations: [
        { id: 'obs-1', url: 'https://example.com/a', signal_id: null },
        { id: 'obs-2', url: 'https://example.com/b', signal_id: null },
      ],
      writeErrorForIds: new Set(['obs-1', 'obs-2']),
    })

    const { result } = await drainOnePage(client, false, null)
    assert.equal(result.writeFailures, 2)
    assert.equal(
      result.processed,
      0,
      'a page where every write fails must never report processed > 0',
    )
    assert.equal(result.ok, 0)
    assert.equal(result.failed, 0)
  })
})

describe('drainOnePage — priority pass correctly isolates ACTIVE-signal-linked observations', () => {
  test('priorityOnly=true only ever returns observations linked to a listed active signal', async () => {
    const { client } = makeMockClient({
      observations: [
        { id: 'obs-1', url: 'https://example.com/a', signal_id: 'sig-active' },
        { id: 'obs-2', url: 'https://example.com/b', signal_id: 'sig-other' },
        { id: 'obs-3', url: 'https://example.com/c', signal_id: null },
      ],
      activeSignalIds: ['sig-active'],
    })

    const { rowsFetched } = await drainOnePage(client, true, null)
    assert.equal(rowsFetched, 1, 'only the one observation linked to the active signal is fetched')
  })

  test('priorityOnly=true with no active signals returns nothing, not an error', async () => {
    const { client } = makeMockClient({
      observations: [{ id: 'obs-1', url: 'https://example.com/a', signal_id: null }],
      activeSignalIds: [],
    })

    const { rowsFetched } = await drainOnePage(client, true, null)
    assert.equal(rowsFetched, 0)
  })
})

describe('drainOnePage — cursor-based pagination', () => {
  test('a cursor correctly excludes already-seen rows on the next call', async () => {
    const { client } = makeMockClient({
      observations: [
        { id: 'obs-1', url: 'https://example.com/a', signal_id: null },
        { id: 'obs-2', url: 'https://example.com/b', signal_id: null },
        { id: 'obs-3', url: 'https://example.com/c', signal_id: null },
      ],
    })

    const first = await drainOnePage(client, false, null)
    assert.equal(first.rowsFetched, 3)

    const second = await drainOnePage(client, false, 'obs-2')
    assert.equal(second.rowsFetched, 1, 'a cursor of obs-2 must only return rows with id > obs-2')
  })
})
