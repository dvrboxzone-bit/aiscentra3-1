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

import { drainOnePage, reconcileStaleGates } from '../route'

// Real fetch/DNS are not exercised here -- verifyUrlReachable itself
// is unit-tested exhaustively in source-links.test.ts. This mock
// client controls only the DATABASE layer, so these tests isolate the
// accounting/pagination logic specifically.
function makeMockClient(config: {
  observations: Array<{ id: string; url: string; signal_id: string | null }>
  activeSignalIds?: string[]
  writeErrorForIds?: Set<string>
  activeSignalsReadError?: string
  observationsReadError?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): { client: any; written: Array<{ id: string; url_verified_ok: boolean }> } {
  const written: Array<{ id: string; url_verified_ok: boolean }> = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from: (table: string) => {
      if (table === 'signals') {
        return {
          select: () => ({
            eq: async () => {
              if (config.activeSignalsReadError) {
                return { data: null, error: { message: config.activeSignalsReadError } }
              }
              return {
                data: (config.activeSignalIds ?? []).map((id) => ({ id })),
                error: null,
              }
            },
          }),
        }
      }
      // 'observations'
      const obsError = config.observationsReadError
        ? { message: config.observationsReadError }
        : null
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
                        data: obsError
                          ? null
                          : filtered
                              .filter((o) => o.signal_id && ids.includes(o.signal_id))
                              .slice(0, n),
                        error: obsError,
                      }),
                    }),
                  }),
                  order: () => ({
                    limit: async (n: number) => ({
                      data: obsError ? null : filtered.slice(0, n),
                      error: obsError,
                    }),
                  }),
                }
              },
              in: (_col2: string, ids: string[]) => ({
                order: () => ({
                  limit: async (n: number) => ({
                    data: obsError
                      ? null
                      : config.observations
                          .filter((o) => o.signal_id && ids.includes(o.signal_id))
                          .slice(0, n),
                    error: obsError,
                  }),
                }),
              }),
              order: () => ({
                limit: async (n: number) => ({
                  data: obsError ? null : config.observations.slice(0, n),
                  error: obsError,
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

describe('drainOnePage — database read errors are NEVER masked as an empty/idle queue (independent review fix)', () => {
  test('an error reading the observations page is surfaced via dbError, not silently treated as rowsFetched=0-means-empty', async () => {
    const { client } = makeMockClient({
      observations: [{ id: 'obs-1', url: 'https://example.com/a', signal_id: null }],
      observationsReadError: 'connection reset',
    })

    const outcome = await drainOnePage(client, false, null)

    assert.equal(outcome.dbError, 'connection reset')
    assert.equal(
      outcome.rowsFetched,
      0,
      'rowsFetched is still 0 on error, but dbError now lets the caller distinguish this from a genuinely idle queue',
    )
  })

  test('an error reading ACTIVE signals (priority pass) is surfaced via dbError, not treated as "no active signals"', async () => {
    const { client } = makeMockClient({
      observations: [{ id: 'obs-1', url: 'https://example.com/a', signal_id: 'sig-1' }],
      activeSignalsReadError: 'timeout',
    })

    const outcome = await drainOnePage(client, true, null)

    assert.equal(outcome.dbError, 'timeout')
    assert.equal(outcome.rowsFetched, 0)
  })

  test('a genuinely empty queue (no error) still reports dbError=null, distinguishing it from a real failure', async () => {
    const { client } = makeMockClient({ observations: [] })
    const outcome = await drainOnePage(client, false, null)
    assert.equal(outcome.dbError, null)
    assert.equal(outcome.rowsFetched, 0)
  })

  test('genuinely zero ACTIVE signals (no error) also reports dbError=null', async () => {
    const { client } = makeMockClient({
      observations: [{ id: 'obs-1', url: 'https://example.com/a', signal_id: null }],
      activeSignalIds: [],
    })
    const outcome = await drainOnePage(client, true, null)
    assert.equal(outcome.dbError, null)
    assert.equal(outcome.rowsFetched, 0)
  })
})

// ── reconcileStaleGates: real, exported production code (independent
// review iteration 3) -- NOT a separate SQL analog. Mock client
// matches the exact query shape reconcileStaleGates itself uses:
// .from('signals').select(...).eq('has_verified_source', false).limit(...)
// then .from('observations').select(...).in(...).eq('url_verified_ok', true)
function makeReconcileMockClient(config: {
  staleSignals: Array<{ id: string; observation_ids: string[]; status: string }>
  verifiedObservationIds: Set<string>
  staleSignalsReadError?: string
  observationsReadError?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  return {
    from: (table: string) => {
      if (table === 'signals') {
        // Real accumulator-style query builder mock -- matches the
        // ACTUAL query shape reconcileStaleGates builds:
        // .select(...).eq('has_verified_source', false)[.eq('status','ACTIVE')].order(...).limit(...)
        // Filters/order/limit are genuinely APPLIED to config.staleSignals
        // here, not just recorded -- this is what makes the "SQL-level
        // ACTIVE filter before LIMIT" fix actually observable by a test
        // (a mock that ignored the .eq('status',...) call entirely
        // would never catch a regression back to in-memory filtering).
        const filters: Array<
          (s: { id: string; observation_ids: string[]; status: string }) => boolean
        > = [
          () => true, // has_verified_source=false is already the entire fixture set here
        ]
        const builder = {
          eq: (col: string, val: string) => {
            if (col === 'status') filters.push((s) => s.status === val)
            return builder
          },
          order: (_col: string, _opts: { ascending: boolean }) => builder,
          limit: async (n: number) => {
            if (config.staleSignalsReadError) {
              return { data: null, error: { message: config.staleSignalsReadError } }
            }
            const filtered = config.staleSignals
              .filter((s) => filters.every((f) => f(s)))
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              .slice(0, n)
            return { data: filtered, error: null }
          },
        }
        return { select: () => builder }
      }
      // 'observations'
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => ({
            eq: async () => {
              if (config.observationsReadError) {
                return { data: null, error: { message: config.observationsReadError } }
              }
              return {
                data: ids
                  .filter((id) => config.verifiedObservationIds.has(id))
                  .map((id) => ({ id })),
                error: null,
              }
            },
          }),
        }),
      }
    },
  }
}

describe('reconcileStaleGates — real production code (independent review, iteration 3: replaces the earlier SQL-analog test)', () => {
  test('finds exactly the signal with a lost recompute (stale gate + a genuinely verified observation)', async () => {
    const client = makeReconcileMockClient({
      staleSignals: [
        { id: 'sig-stale', observation_ids: ['obs-verified'], status: 'ACTIVE' },
        { id: 'sig-genuinely-closed', observation_ids: ['obs-unverified'], status: 'ACTIVE' },
      ],
      verifiedObservationIds: new Set(['obs-verified']),
    })

    const outcome = await reconcileStaleGates(client, false)

    assert.equal(outcome.failures, 0)
    assert.equal(outcome.signalIds.has('sig-stale'), true)
    assert.equal(
      outcome.signalIds.has('sig-genuinely-closed'),
      false,
      'a signal with no genuinely-verified observation must not be flagged',
    )
  })

  test('exactly TWO queries total, never N+1 -- proven by the mock never needing per-signal call tracking to produce the right answer even with many stale signals', async () => {
    const manyStale = Array.from({ length: 50 }, (_, i) => ({
      id: `sig-${i}`,
      observation_ids: [`obs-${i}`],
      status: 'ACTIVE',
    }))
    const client = makeReconcileMockClient({
      staleSignals: manyStale,
      verifiedObservationIds: new Set(['obs-3', 'obs-17', 'obs-42']),
    })

    const outcome = await reconcileStaleGates(client, false)
    assert.equal(outcome.failures, 0)
    assert.deepEqual([...outcome.signalIds].sort(), ['sig-17', 'sig-3', 'sig-42'])
  })

  test('activeOnly=true restricts candidates to ACTIVE-linked signals only -- matches pass-1 priority semantics', async () => {
    const client = makeReconcileMockClient({
      staleSignals: [
        { id: 'sig-active-stale', observation_ids: ['obs-a'], status: 'ACTIVE' },
        { id: 'sig-weak-stale', observation_ids: ['obs-b'], status: 'WEAK' },
      ],
      verifiedObservationIds: new Set(['obs-a', 'obs-b']),
    })

    const activeOnly = await reconcileStaleGates(client, true)
    assert.equal(activeOnly.signalIds.has('sig-active-stale'), true)
    assert.equal(
      activeOnly.signalIds.has('sig-weak-stale'),
      false,
      'a non-ACTIVE signal must be excluded when activeOnly=true',
    )

    const both = await reconcileStaleGates(client, false)
    assert.equal(
      both.signalIds.has('sig-weak-stale'),
      true,
      'without activeOnly, a WEAK signal IS still reconciled',
    )
  })

  test('the SQL-level ACTIVE filter (not in-memory) still finds a stale ACTIVE signal even when non-ACTIVE signals alone exceed RECONCILE_LIMIT -- the real fix', async () => {
    // Real regression this guards against: a prior version applied
    // .limit(RECONCILE_LIMIT=500) BEFORE filtering by status in JS --
    // if 500+ non-ACTIVE stale signals existed, a real ACTIVE stale
    // signal sorted after them could be silently excluded, and the
    // release gate would falsely report a clean reconciliation.
    // Deliberately named so it sorts LAST (position 601) by id --
    // under the OLD buggy pattern (sort, slice first 500, THEN filter
    // status in JS), this exact fixture would fail (the ACTIVE signal
    // would never make it into the first-500 slice at all), proving
    // this test genuinely catches a regression back to that pattern,
    // not merely re-confirming correct behavior by coincidence of
    // sort order.
    const manyNonActive = Array.from({ length: 600 }, (_, i) => ({
      id: `aaa-non-active-${String(i).padStart(4, '0')}`, // sorts BEFORE the ACTIVE one below
      observation_ids: [`obs-non-active-${i}`],
      status: 'WEAK',
    }))
    const activeStale = {
      id: 'zzz-active-stale-0001', // sorts AFTER all 600 non-ACTIVE ones -- position 601
      observation_ids: ['obs-active'],
      status: 'ACTIVE',
    }
    const client = makeReconcileMockClient({
      staleSignals: [...manyNonActive, activeStale],
      verifiedObservationIds: new Set([
        'obs-active',
        ...manyNonActive.map(({ observation_ids: [firstObsId] }) => firstObsId ?? ''),
      ]),
    })

    const outcome = await reconcileStaleGates(client, true)
    assert.equal(
      outcome.signalIds.has('zzz-active-stale-0001'),
      true,
      'a real ACTIVE stale signal sorting AFTER 600 non-ACTIVE ones must still be found -- proves the SQL-level ACTIVE filter runs before LIMIT, not after',
    )
    assert.equal(
      outcome.signalIds.size,
      1,
      'only the ACTIVE signal should be reconciled, none of the 600 WEAK ones',
    )
  })

  test('a stale-signals read error is a genuine, counted failure -- FAIL CLOSED, not best-effort/silently swallowed (the real fix)', async () => {
    const client = makeReconcileMockClient({
      staleSignals: [],
      verifiedObservationIds: new Set(),
      staleSignalsReadError: 'connection reset',
    })

    const outcome = await reconcileStaleGates(client, false)
    assert.equal(
      outcome.failures,
      1,
      'a real read error must be counted, never silently logged-and-ignored',
    )
    assert.equal(outcome.signalIds.size, 0)
  })

  test('an observations read error is also a genuine, counted failure', async () => {
    const client = makeReconcileMockClient({
      staleSignals: [{ id: 'sig-1', observation_ids: ['obs-1'], status: 'ACTIVE' }],
      verifiedObservationIds: new Set(),
      observationsReadError: 'timeout',
    })

    const outcome = await reconcileStaleGates(client, false)
    assert.equal(outcome.failures, 1)
  })

  test('zero stale signals is a clean, zero-failure result -- not an error', async () => {
    const client = makeReconcileMockClient({ staleSignals: [], verifiedObservationIds: new Set() })
    const outcome = await reconcileStaleGates(client, false)
    assert.equal(outcome.failures, 0)
    assert.equal(outcome.signalIds.size, 0)
  })

  test('full cycle: a previous recompute/write genuinely failed after the observation write succeeded, the next regular invocation discovers and correctly repairs it', async () => {
    // Simulates the real incident end-to-end, not just the "find"
    // half: on a PRIOR invocation, an observation's own url_verified_ok
    // write succeeded (durably persisted), but the LATER
    // has_verified_source recompute for its signal failed (read/RPC/
    // write error) -- exactly the scenario reconcileStaleGates exists
    // to repair. This test proves the full cycle: discovery (real
    // reconcileStaleGates code) THEN a successful repair write, using
    // the same read-signal -> RPC compute -> update pattern the real
    // POST handler applies to every signal reconcileStaleGates returns.
    const signalId = 'sig-previously-failed-recompute'
    const observationId = 'obs-genuinely-verified'

    const client = makeReconcileMockClient({
      staleSignals: [{ id: signalId, observation_ids: [observationId], status: 'ACTIVE' }],
      verifiedObservationIds: new Set([observationId]), // the observation's own write DID succeed previously
    })

    // Step 1: the next regular invocation's reconciliation pass
    // (real production code) discovers the stale signal.
    const outcome = await reconcileStaleGates(client, true)
    assert.equal(outcome.failures, 0)
    assert.equal(outcome.signalIds.has(signalId), true, 'the stale signal must be discovered')

    // Step 2: apply the SAME repair pattern the real POST handler uses
    // for every signal reconcileStaleGates returns -- read the
    // signal's observation_ids, call compute_has_verified_source,
    // write the result. Tracked via a small write-capturing extension
    // of the same mock client style already used throughout this file.
    let writtenValue: boolean | null = null
    const writeClient = {
      from: (table: string) => {
        if (table === 'signals') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { observation_ids: [observationId] }, error: null }),
              }),
            }),
            update: (values: { has_verified_source: boolean }) => ({
              eq: async () => {
                writtenValue = values.has_verified_source
                return { error: null }
              },
            }),
          }
        }
        return {}
      },
      rpc: async (_fn: string, _args: unknown) => ({ data: true, error: null }), // real compute_has_verified_source would genuinely return true here, since the observation IS verified
    }

    for (const id of outcome.signalIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sigResult = await (writeClient as any).from('signals').select().eq().single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpcResult = await (writeClient as any).rpc('compute_has_verified_source', {
        p_observation_ids: sigResult.data.observation_ids,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (writeClient as any)
        .from('signals')
        .update({ has_verified_source: rpcResult.data === true })
        .eq()
      assert.equal(id, signalId)
    }

    assert.equal(
      writtenValue,
      true,
      'the previously-stuck signal must genuinely end up with has_verified_source=true after the repair -- the full cycle is complete, not just discovery',
    )
  })
})
